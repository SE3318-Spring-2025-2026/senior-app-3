const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');

/**
 * SanitizationServiceError — Custom error for sanitization operations.
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
 * checkDeadlineElapsed(scheduleDeadline)
 *
 * Validates that the provided deadline has passed.
 * Throws 409 if deadline has not yet elapsed.
 *
 * @param {Date|string} scheduleDeadline — ISO date string or Date object
 * @throws {SanitizationServiceError} if deadline not reached
 */
function checkDeadlineElapsed(scheduleDeadline) {
  const deadline = new Date(scheduleDeadline);
  const now = new Date();

  if (now < deadline) {
    throw new SanitizationServiceError(
      409,
      'DEADLINE_NOT_REACHED',
      `Sanitization deadline not reached. Current time: ${now.toISOString()}, Deadline: ${deadline.toISOString()}`
    );
  }
}

/**
 * fetchUnassignedGroups(optionalGroupIds)
 *
 * Queries D2 for all active groups without an assigned advisor.
 *
 * @param {string[]} optionalGroupIds — If provided, filter to these group IDs only
 * @returns {Promise<Array>} Array of group documents with no advisor
 */
async function fetchUnassignedGroups(optionalGroupIds = null) {
  const query = {
    status: 'active',
    advisorId: null,
  };

  if (optionalGroupIds && optionalGroupIds.length > 0) {
    query.groupId = { $in: optionalGroupIds };
  }

  return Group.find(query).select('groupId groupName leaderId members');
}

/**
 * disbandGroupBatch(groupIds, coordinatorId, options)
 *
 * Batch disband operation: updates group status to 'inactive' and clears advisorId.
 * Individual failures don't block others (non-fatal batch processing).
 *
 * @param {string[]} groupIds — Array of group IDs to disband
 * @param {string} coordinatorId — Coordinator performing the action
 * @param {Object} options
 *   - reason: string (optional, for audit trail)
 *
 * @returns {Promise<{ disbandedGroups: Array, failedGroups: Array }>}
 *   - disbandedGroups: [{ groupId, membersNotified: Array }]
 *   - failedGroups: [{ groupId, error }]
 */
async function disbandGroupBatch(groupIds, coordinatorId, options = {}) {
  const { reason = 'Advisor assignment deadline elapsed' } = options;
  const disbandedGroups = [];
  const failedGroups = [];

  for (const groupId of groupIds) {
    try {
      const group = await Group.findOne({ groupId });
      if (!group) {
        failedGroups.push({ groupId, error: 'Group not found' });
        continue;
      }

      // Extract member IDs for notification
      const membersToNotify = group.members.map((m) => m.userId);

      // Update group to inactive
      group.status = 'inactive';
      group.advisorId = null;
      group.advisorStatus = null;
      group.advisorUpdatedAt = new Date();
      await group.save();

      // Create audit log
      await createAuditLog({
        action: 'group_disband',
        userId: coordinatorId,
        resourceType: 'group',
        resourceId: groupId,
        changeDetails: {
          reason,
          oldStatus: 'active',
          newStatus: 'inactive',
          membersNotified: membersToNotify.length,
        },
      });

      disbandedGroups.push({
        groupId,
        groupName: group.groupName,
        membersNotified: membersToNotify,
      });
    } catch (err) {
      console.error(`[Sanitization] Error disbanding group ${groupId}:`, err.message);
      failedGroups.push({
        groupId,
        error: err.message,
      });
    }
  }

  return { disbandedGroups, failedGroups };
}

module.exports = {
  checkDeadlineElapsed,
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
};
