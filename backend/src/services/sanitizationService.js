/**
 * ========================================
 * Issue #67, #69 & #70: Post-Deadline Sanitization Service
 * ========================================
 * * Process 3.7 of the advisor association flow.
 * Identifies and disbands groups without advisors using high-performance bulk operations.
 */

const Group = require('../models/Group');
const ScheduleWindow = require('../models/ScheduleWindow');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('../services/auditService');

/**
 * Custom error class for sanitization service operations.
 */
class SanitizationServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'SanitizationServiceError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Fix #1: SECURITY - Fetch deadline from ScheduleWindow DB
 * Use the authoritative endsAt timestamp from the database to prevent manipulation.
 * Throws 409 if triggered before the deadline passes.
 */
const checkScheduleWindowDeadline = async () => {
  const now = new Date();
  
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
 * Legacy check for backward compatibility.
 * @deprecated Use checkScheduleWindowDeadline instead
 */
const checkDeadlineElapsed = async (scheduleDeadline) => {
  const deadline = new Date(scheduleDeadline);
  if (new Date() < deadline) {
    throw new SanitizationServiceError(
      409,
      'DEADLINE_NOT_REACHED',
      `Sanitization cannot run before the deadline: ${deadline.toISOString()}`
    );
  }
};

/**
 * Fetch all unassigned groups eligible for sanitization.
 * Optimized with .lean() and specific field selection.
 * Criteria: status === 'active' AND advisorId === null
 */
const fetchUnassignedGroups = async (optionalGroupIds = null) => {
  const query = {
    status: 'active',
    advisorId: null,
  };

  if (optionalGroupIds && optionalGroupIds.length > 0) {
    query.groupId = { $in: optionalGroupIds };
  }

  return Group.find(query)
    .select('groupId groupName leaderId members advisorId advisorStatus')
    .lean();
};

/**
 * Batch disband groups using Mongoose bulkWrite for database efficiency.
 * Fix #3: Single DB round-trip instead of N+1 writes.
 */
const BULK_WRITE_MAX_ATTEMPTS = 3;

const disbandGroupBatch = async (groups, coordinatorId, options = {}) => {
  const errors = [];
  if (!groups.length) return { disbanded_count: 0, failed_count: 0, disbanded_ids: [], errors: [] };

  // Prepare bulk operations: update status to 'disbanded' and clear advisor fields
  const ops = groups.map((group) => ({
    updateOne: {
      filter: { groupId: group.groupId, status: 'active', advisorId: null },
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

  // Execute bulkWrite with retry logic
  for (let attempt = 0; attempt < BULK_WRITE_MAX_ATTEMPTS; attempt++) {
    try {
      await Group.bulkWrite(ops, { ordered: false });
      break;
    } catch (bulkErr) {
      if (attempt === BULK_WRITE_MAX_ATTEMPTS - 1) {
        throw new SanitizationServiceError(500, 'BULK_WRITE_FAILED', bulkErr.message);
      }
    }
  }

  // Verify results for auditing and notifications
  const groupIds = groups.map((g) => g.groupId);
  const disbandedRows = await Group.find({ groupId: { $in: groupIds }, status: 'disbanded' })
    .select('groupId groupName members')
    .lean();

  const disbandedSet = new Set(disbandedRows.map((r) => r.groupId));
  const disbanded_ids = groupIds.filter((id) => disbandedSet.has(id));
  const failed = groupIds.filter((id) => !disbandedSet.has(id));

  // Handle Failures & Sync Error Logging
  for (const gid of failed) {
    const errorMsg = 'Group not found or status already changed';
    errors.push({ groupId: gid, error: errorMsg });
    
    await SyncErrorLog.create({
      errorType: 'advisor_sanitization_failed',
      targetId: gid,
      groupId: gid,
      message: errorMsg,
      timestamp: new Date(),
      details: { operation: 'disband_group', reason: 'advisor_association_deadline_missed' },
    }).catch(e => console.error(`[Sanitization] Failed to log error for ${gid}:`, e.message));
  }

  // Audit successful disbands
  const groupById = new Map(disbandedRows.map((g) => [g.groupId, g]));
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
          reason: options.reason || 'advisor_association_deadline_missed',
        },
        ipAddress: options.ipAddress || 'system',
        userAgent: options.userAgent || 'advisor-sanitization-job',
      });
    } catch (auditErr) {
      console.error(`[Sanitization] Audit log failed for ${gid}:`, auditErr.message);
    }
  }

  // Map result for controller (backwards compatibility for notification dispatch)
  return {
    disbanded_count: disbanded_ids.length,
    failed_count: failed.length,
    disbanded_ids,
    disbandedGroups: disbandedRows.map(r => ({
      groupId: r.groupId,
      groupName: r.groupName,
      membersNotified: r.members.map(m => m.userId)
    })),
    errors,
  };
};

module.exports = {
  checkScheduleWindowDeadline,
  checkDeadlineElapsed,
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
};