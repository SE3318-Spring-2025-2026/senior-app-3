const Group = require('../models/Group');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('../utils/auditLogger');
const SyncErrorLog = require('../models/SyncErrorLog');

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
 * Check if the advisor_association schedule deadline has elapsed.
 * Throws 409 if triggered before deadline passes.
 *
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
 * Criteria: status === 'active' AND advisorId === null
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
 * Batch disband groups by updating their status to 'inactive'.
 * Creates audit logs for each disband operation.
 *
 * @param {object[]} groups - Array of group objects to disband
 * @param {string} coordinatorId - ID of coordinator/system triggering sanitization
 * @param {object} options - Additional options
 * @returns {Promise<{disbanded_count: number, failed_count: number, disbanded_ids: string[], errors: object[]}>}
 */
const disbandGroupBatch = async (groups, coordinatorId, options = {}) => {
  const disbanded = [];
  const failed = [];
  const errors = [];

  for (const group of groups) {
    try {
      // Update group status to 'inactive'
      const updatedGroup = await Group.findOneAndUpdate(
        { groupId: group.groupId },
        {
          status: 'inactive',
          advisorId: null,
          advisorStatus: null,
          updatedAt: new Date(),
        },
        { new: true }
      );

      if (!updatedGroup) {
        throw new Error(`Group ${group.groupId} not found during disband`);
      }

      // Create audit log for disband operation
      await createAuditLog({
        action: 'group_sanitized',
        actorId: coordinatorId,
        targetId: group.groupId,
        groupId: group.groupId,
        payload: {
          previous_status: 'active',
          new_status: 'inactive',
          reason: 'advisor_association_deadline_missed',
          previous_advisor_id: group.advisorId,
        },
        ipAddress: options.ipAddress || 'system',
        userAgent: options.userAgent || 'advisor-sanitization-job',
      });

      disbanded.push(group.groupId);
    } catch (err) {
      failed.push(group.groupId);
      errors.push({
        groupId: group.groupId,
        error: err.message,
      });

      // Log sync error for tracking
      try {
        await SyncErrorLog.create({
          errorType: 'advisor_sanitization_failed',
          targetId: group.groupId,
          groupId: group.groupId,
          message: err.message,
          timestamp: new Date(),
          details: {
            operation: 'disband_group',
            reason: 'advisor_association_deadline_missed',
          },
        });
      } catch (logErr) {
        console.error(
          `Failed to log sync error for group ${group.groupId}:`,
          logErr.message
        );
      }
    }
  }

  return {
    disbanded_count: disbanded.length,
    failed_count: failed.length,
    disbanded_ids: disbanded,
    errors,
  };
};

module.exports = {
  checkDeadlineElapsed,
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
};
