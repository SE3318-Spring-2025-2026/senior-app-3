/**
 * Group Status Transition Service
 * Issue #52: Group Status Transitions & Lifecycle Management
 *
 * Handles state machine logic for group lifecycle:
 * - Validates status transitions
 * - Applies transitions to database
 * - Records transition history in audit log
 */

const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');
const {
  GROUP_STATUS,
  VALID_STATUS_TRANSITIONS,
  INACTIVE_GROUP_STATUSES,
} = require('../utils/groupStatusEnum');

/**
 * Validates if a status transition is allowed.
 *
 * @param {string} currentStatus - Current group status
 * @param {string} targetStatus - Desired target status
 * @returns {object} { isValid: boolean, reason?: string }
 */
const validateTransition = (currentStatus, targetStatus) => {
  if (currentStatus === targetStatus) {
    return {
      isValid: false,
      reason: 'Target status is the same as current status',
    };
  }

  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];

  if (!allowedTransitions) {
    return {
      isValid: false,
      reason: `Unknown current status: '${currentStatus}'`,
    };
  }

  if (!allowedTransitions.has(targetStatus)) {
    return {
      isValid: false,
      reason: `Invalid transition from '${currentStatus}' to '${targetStatus}'. Allowed: ${[...allowedTransitions].join(', ') || 'none'}`,
      current: currentStatus,
      attempted: targetStatus,
      allowed: [...allowedTransitions],
    };
  }

  return { isValid: true };
};

/**
 * Transitions a group to a new status.
 *
 * Flow:
 * 1. Validate the transition is allowed
 * 2. Update group status in D2
 * 3. Record the transition in audit log (event: status_transition)
 *
 * @param {string} groupId - Group ID
 * @param {string} targetStatus - Target status
 * @param {object} options - Transition options
 * @param {string} options.actorId - User performing the transition
 * @param {string} options.reason - Reason for the transition
 * @param {string} options.ipAddress - IP address of the request
 * @param {string} options.userAgent - User agent of the request
 * @returns {object} Updated group document
 * @throws {Error} If group not found or transition invalid
 */
const transitionGroupStatus = async (groupId, targetStatus, options = {}) => {
  const {
    actorId = null,
    reason = '',
    ipAddress = null,
    userAgent = null,
  } = options;

  // Fetch the group
  const group = await Group.findOne({ groupId });
  if (!group) {
    const error = new Error('Group not found');
    error.code = 'GROUP_NOT_FOUND';
    throw error;
  }

  // Validate the transition
  const validation = validateTransition(group.status, targetStatus);
  if (!validation.isValid) {
    const error = new Error(validation.reason);
    error.code = 'INVALID_STATUS_TRANSITION';
    error.current = validation.current;
    error.attempted = validation.attempted;
    error.allowed = validation.allowed;
    throw error;
  }

  // Apply the transition (D2 update — f18)
  const previousStatus = group.status;
  group.status = targetStatus;
  await group.save();

  // Record in audit log (status_transition event)
  try {
    await createAuditLog({
      action: 'status_transition',
      actorId,
      targetId: groupId,
      groupId,
      payload: {
        previous_status: previousStatus,
        new_status: targetStatus,
        reason,
      },
      ipAddress,
      userAgent,
    });
  } catch (auditError) {
    console.error('status_transition audit log failed (non-fatal):', auditError.message);
  }

  return group;
};

/**
 * Transitions a group to ACTIVE status after validation + processing.
 *
 * Called when Process 2.2 validation + 2.5 processing complete.
 * Updates group status from pending_validation → active (D2 update).
 *
 * @param {string} groupId - Group ID
 * @param {object} options - Transition options
 * @returns {object} Updated group document
 */
const activateGroup = async (groupId, options = {}) => {
  return transitionGroupStatus(groupId, GROUP_STATUS.ACTIVE, {
    reason: 'Validation and processing completed successfully',
    ...options,
  });
};

/**
 * Transitions a group to INACTIVE status.
 *
 * Called by coordinator or sanitization protocol.
 * Updates group status to inactive, preventing new member additions.
 *
 * @param {string} groupId - Group ID
 * @param {object} options - Transition options
 * @returns {object} Updated group document
 */
const deactivateGroup = async (groupId, options = {}) => {
  return transitionGroupStatus(groupId, GROUP_STATUS.INACTIVE, {
    reason: 'Group deactivated',
    ...options,
  });
};

/**
 * Transitions a group to REJECTED status.
 *
 * Called when validation fails in 2.2 or by coordinator.
 * Rejects the group, preventing further member additions.
 *
 * @param {string} groupId - Group ID
 * @param {object} options - Transition options
 * @returns {object} Updated group document
 */
const rejectGroup = async (groupId, options = {}) => {
  return transitionGroupStatus(groupId, GROUP_STATUS.REJECTED, {
    reason: 'Group validation failed or coordinator rejection',
    ...options,
  });
};

/**
 * Checks if a group is in an inactive state (cannot receive members).
 *
 * @param {string|object} groupOrGroupId - Group document or group ID
 * @returns {boolean} True if group is inactive
 */
const isGroupInactive = async (groupOrGroupId) => {
  let group;

  if (typeof groupOrGroupId === 'string') {
    group = await Group.findOne({ groupId: groupOrGroupId });
    if (!group) {
      const error = new Error('Group not found');
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }
  } else {
    group = groupOrGroupId;
  }

  return INACTIVE_GROUP_STATUSES.has(group.status);
};

module.exports = {
  validateTransition,
  transitionGroupStatus,
  activateGroup,
  deactivateGroup,
  rejectGroup,
  isGroupInactive,
};
