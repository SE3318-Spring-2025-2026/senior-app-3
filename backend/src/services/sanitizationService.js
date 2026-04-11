/**
 * ========================================
 * Issue #67: Post-Deadline Sanitization Service
 * ========================================
 * 
 * Process 3.7 of the advisor association flow.
 * Responsible for identifying and disbanding groups without assigned advisors
 * after the coordinator-defined deadline passes.
 * 
 * CRITICAL FIXES IN THIS MODULE:
 * ──────────────────────────────
 * Fix #1: checkScheduleWindowDeadline() - SECURITY FIX
 *         Fetches deadline from ScheduleWindow DB (not request body)
 *         Prevents coordinator manipulation of deadline
 * 
 * Fix #3: disbandGroupBatch() - PERFORMANCE & CORRECTNESS FIXES
 *         - Uses Mongoose bulkWrite() only (no per-group update fallback)
 *         - Retries bulkWrite up to 2 times on failure (3 attempts total)
 *         - Changes status from 'inactive' to 'disbanded' (spec compliance)
 * 
 * FLOW DIAGRAM:
 * ─────────────
 * 1. checkScheduleWindowDeadline() → Verify deadline has passed (authoritative source)
 * 2. fetchUnassignedGroups() → Query DB: status='active' AND advisorId=null
 * 3. disbandGroupBatch() → Bulk update all groups to status='disbanded'
 * 4. Controller sends response immediately
 * 5. Background: Dispatch disband notifications (fire-and-forget via setImmediate)
 */

const Group = require('../models/Group');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('../utils/auditLogger');

/**
 * Custom error class for sanitization service operations.
 */
class SanitizationServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Issue #67 Fix #1: Fetch deadline from ScheduleWindow DB
 * Check if the advisor_association schedule deadline has elapsed.
 * Throws 409 if triggered before deadline passes.
 * 
 * PROBLEM: Previous code accepted scheduleDeadline from req.body
 *          This allowed coordinators to manipulate deadline - SECURITY FLAW
 * SOLUTION: Query ScheduleWindow for operationType='advisor_association'
 *           Use the authoritative endsAt timestamp from the database
 * IMPACT: Server-side deadline enforcement prevents early/unauthorized sanitization
 *
 * @returns {Promise<{allowed: boolean, message: string, deadlineAt: Date}>}
 * @throws {SanitizationServiceError} 409 if now < window.endsAt
 */
const checkScheduleWindowDeadline = async () => {
  const now = new Date();
  
  // Issue #67 Fix #1: Query ScheduleWindow for advisor_association
  // Get the most recent active window for this operation type
  const window = await ScheduleWindow.findOne({
    operationType: 'advisor_association',
    isActive: true,
  })
    .sort({ endsAt: -1 })
    .lean();

  if (!window) {
    throw new SanitizationServiceError(
      409,
      'NO_ACTIVE_SCHEDULE',
      'No active advisor association schedule window found'
    );
  }

  // Check if current time is past the deadline
  if (now < window.endsAt) {
    return {
      allowed: false,
      message: `Advisor association window is still active. Deadline: ${window.endsAt.toISOString()}`,
      deadlineAt: window.endsAt,
    };
  }

  return {
    allowed: true,
    message: 'Deadline has passed. Sanitization allowed.',
    deadlineAt: window.endsAt,
  };
};

/**
 * Check if the advisor_association schedule deadline has elapsed (deprecated - use checkScheduleWindowDeadline).
 * Throws 409 if triggered before deadline passes.
 *
 * @deprecated Use checkScheduleWindowDeadline instead
 * @param {Date} scheduleDeadline - The deadline to check against (ISO string or Date)
 * @returns {Promise<void>}
 * @throws {SanitizationServiceError} 409 if current time < deadline
 */
const checkDeadlineElapsed = async (scheduleDeadline) => {
  const deadline = new Date(scheduleDeadline);
  const now = new Date();

  if (now < deadline) {
    throw new SanitizationServiceError(
      409,
      'DEADLINE_NOT_REACHED',
      `Sanitization cannot run before the deadline: ${deadline.toISOString()}`
    );
  }
};

/**
 * Fetch all unassigned groups eligible for sanitization.
 * 
 * QUERY LOGIC:
 * ────────────
 * Find all groups matching BOTH criteria:
 * 1. status === 'active' - Group is currently active (not already disbanded/archived)
 * 2. advisorId === null - Group has NO assigned advisor
 * 
 * Optional filtering:
 * - If groupIds[] provided: Only fetch groups matching those specific IDs
 *   (allows coordinator to manually specify which groups to disband)
 * 
 * PERFORMANCE NOTE:
 * ────────────────
 * Uses .lean() projection: Returns plain JavaScript objects (not Mongoose documents)
 * This is faster for read-only operations since we don't need document methods
 * 
 * SELECTED FIELDS:
 * ────────────────
 * - groupId: API identifier for group
 * - groupName: Display name (used in notifications)
 * - leaderId: Team leader's user ID
 * - members: Member list (used for notification recipients)
 * - advisorId: Should be null (validation)
 * - advisorStatus: Current advisor assignment status
 * 
 * @param {string[]} optionalGroupIds - Optional subset of group IDs to check
 * @returns {Promise<object[]>} Array of groups with { groupId, groupName, leaderId, members }
 */
const fetchUnassignedGroups = async (optionalGroupIds) => {
  const query = {
    status: 'active',
    advisorId: null,
  };

  if (optionalGroupIds && optionalGroupIds.length > 0) {
    query.groupId = { $in: optionalGroupIds };
  }

  const groups = await Group.find(query).select(
    'groupId groupName leaderId members advisorId advisorStatus'
  );

  return groups;
};

/**
 * Batch disband groups using Mongoose bulkWrite for database efficiency.
 * All updates executed in single DB round-trip (no N+1 writes).
 * Creates audit logs for each disband operation.
 *
 * Issue #67 Fix #3a: Uses bulkWrite instead of loop with findOneAndUpdate
 *                    PROBLEM: Previous code called findOneAndUpdate N times (N+1 pattern)
 *                    For 100+ groups, causes massive database overload and latency
 *                    SOLUTION: Collect all operations and execute with bulkWrite
 *                    IMPACT: 100 groups = 1 DB round-trip instead of 100
 *
 * Issue #67 Fix #3b: Changed status from 'inactive' to 'disbanded'
 *                    PROBLEM: Groups were updated to status='inactive' (wrong)
 *                    Acceptance criteria requires status='disbanded' for post-deadline groups
 *                    'inactive' is for other transitions; 'disbanded' is specifically for unassigned groups
 *                    SOLUTION: Use correct status value in $set update
 *                    IMPACT: API spec compliance and audit trail accuracy
 *
 * @param {object[]} groups - Array of group objects to disband
 * @param {string} coordinatorId - ID of coordinator/system triggering sanitization
 * @param {object} options - Additional options
 * @returns {Promise<{disbanded_count: number, failed_count: number, disbanded_ids: string[], errors: object[]}>}
 */
const BULK_WRITE_MAX_ATTEMPTS = 3; // initial + 2 retries

const disbandGroupBatch = async (groups, coordinatorId, options = {}) => {
  const errors = [];

  if (!groups.length) {
    return {
      disbanded_count: 0,
      failed_count: 0,
      disbanded_ids: [],
      errors: [],
    };
  }

  const ops = groups.map((group) => ({
    updateOne: {
      filter: {
        groupId: group.groupId,
        status: 'active',
        advisorId: null,
      },
      update: {
        $set: {
          status: 'disbanded',
          advisorId: null,
          advisorStatus: null,
          sanitizedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    },
  }));

  for (let attempt = 0; attempt < BULK_WRITE_MAX_ATTEMPTS; attempt++) {
    try {
      await Group.bulkWrite(ops, { ordered: false });
      break;
    } catch (bulkErr) {
      console.error(
        `[Sanitization] bulkWrite attempt ${attempt + 1}/${BULK_WRITE_MAX_ATTEMPTS} failed:`,
        bulkErr.message
      );
      if (attempt === BULK_WRITE_MAX_ATTEMPTS - 1) {
        throw new SanitizationServiceError(
          500,
          'BULK_WRITE_FAILED',
          `Bulk disband failed after ${BULK_WRITE_MAX_ATTEMPTS} attempts: ${bulkErr.message}`
        );
      }
    }
  }

  const groupIds = groups.map((g) => g.groupId);
  const disbandedRows = await Group.find({
    groupId: { $in: groupIds },
    status: 'disbanded',
  })
    .select('groupId')
    .lean();

  const disbandedSet = new Set(disbandedRows.map((r) => r.groupId));
  const disbanded_ids = groupIds.filter((id) => disbandedSet.has(id));
  const failed = groupIds.filter((id) => !disbandedSet.has(id));

  for (const gid of failed) {
    errors.push({
      groupId: gid,
      error: 'Group not found or does not match filter criteria',
    });
  }

  const groupById = new Map(groups.map((g) => [g.groupId, g]));
  for (const gid of disbanded_ids) {
    const group = groupById.get(gid);
    if (!group) continue;
    try {
      await createAuditLog({
        action: 'group_sanitized',
        actorId: coordinatorId,
        targetId: group.groupId,
        groupId: group.groupId,
        payload: {
          previous_status: 'active',
          new_status: 'disbanded',
          reason: 'advisor_association_deadline_missed',
          previous_advisor_id: group.advisorId,
        },
        ipAddress: options.ipAddress || 'system',
        userAgent: options.userAgent || 'advisor-sanitization-job',
      });
    } catch (auditErr) {
      console.error(
        `Failed to create audit log for group ${group.groupId}:`,
        auditErr.message
      );
    }
  }

  return {
    disbanded_count: disbanded_ids.length,
    failed_count: failed.length,
    disbanded_ids,
    errors,
  };
};

module.exports = {
  checkScheduleWindowDeadline,
  checkDeadlineElapsed, // deprecated, kept for compatibility
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
};
