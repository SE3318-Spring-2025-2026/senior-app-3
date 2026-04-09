/**
 * AdvisorAssignmentService
 *
 * Business logic layer for advisor assignment operations.
 * Orchestrates write operations from processes 3.2, 3.5, 3.6, and 3.7.
 * Implements transaction-safe operations, conflict detection, and data integrity checks.
 *
 * Issue #68 - D2 Advisor Assignment Schema & Write Operations
 */

const AdvisorAssignmentRepository = require('../repositories/AdvisorAssignmentRepository');
const Group = require('../models/Group');
const User = require('../models/User');

/**
 * ADVISOR REQUEST CREATION - Process 3.2 (f03: 3.2 → D2)
 */

/**
 * Validate and create advisor request after process 3.2 validation.
 *
 * Validation checks:
 * 1. Group exists in D2
 * 2. Professor exists in User accounts
 * 3. Group doesn't have existing advisor or pending request (409 Conflict)
 *
 * @param {object} requestData - {
 *   groupId: string,
 *   professorId: string,
 *   requesterId: string,
 *   message?: string
 * }
 * @returns {Promise<object>} { success: true, group, requestId }
 * @throws {Error} with status code for validation failures
 */
async function validateAndCreateAdvisorRequest(requestData) {
  const { groupId, professorId, requesterId, message } = requestData;

  // 1. Verify group exists
  const group = await Group.findOne({ groupId });
  if (!group) {
    const err = new Error(`Group ${groupId} not found`);
    err.statusCode = 404;
    throw err;
  }

  // 2. Verify professor exists
  const professor = await User.findOne({ userId: professorId });
  if (!professor) {
    const err = new Error(`Professor ${professorId} not found`);
    err.statusCode = 404;
    throw err;
  }

  // 3. Check for existing advisor or pending request conflict
  const hasConflict = await AdvisorAssignmentRepository.hasAdvisorConflict(groupId);
  if (hasConflict) {
    const err = new Error(
      'Group already has an assigned advisor or a pending advisor request'
    );
    err.statusCode = 409;
    throw err;
  }

  // 4. Create advisor request
  const updatedGroup = await AdvisorAssignmentRepository.createAdvisorRequest(
    groupId,
    {
      professorId,
      requesterId,
      message,
      notificationTriggered: false, // Will be set to true after notification dispatch
    }
  );

  return {
    success: true,
    group: updatedGroup,
    requestId: updatedGroup.advisorRequest.requestId,
  };
}

/**
 * ADVISOR ASSIGNMENT - Process 3.5 (f08: 3.5 → D2 — assign path)
 */

/**
 * Approve advisor request and assign advisor to group.
 * Called after process 3.4 (advisor decision) approves the request.
 *
 * @param {string} groupId - Group identifier
 * @param {string} requestId - Advisor request identifier
 * @param {object} options - { professorId }
 * @returns {Promise<object>} { success: true, group, assignment }
 * @throws {Error} with status code for validation failures
 */
async function approveAndAssignAdvisor(groupId, requestId, options = {}) {
  const { professorId } = options;

  // Verify group exists and has pending request
  const group = await Group.findOne({ groupId });
  if (!group) {
    const err = new Error(`Group ${groupId} not found`);
    err.statusCode = 404;
    throw err;
  }

  if (!group.advisorRequest?.requestId || group.advisorRequest.requestId !== requestId) {
    const err = new Error('No matching advisor request found for this group');
    err.statusCode = 404;
    throw err;
  }

  if (group.advisorRequest.status !== 'pending') {
    const err = new Error(
      `Advisor request has already been processed: ${group.advisorRequest.status}`
    );
    err.statusCode = 409;
    throw err;
  }

  // Verify professor exists
  const professor = await User.findOne({ userId: professorId });
  if (!professor) {
    const err = new Error(`Professor ${professorId} not found`);
    err.statusCode = 404;
    throw err;
  }

  // Assign advisor and clear request
  const updatedGroup = await AdvisorAssignmentRepository.assignAdvisor(
    groupId,
    professorId,
    { requestId }
  );

  // Update request status to approved
  updatedGroup.advisorRequest.status = 'approved';
  await updatedGroup.save();

  return {
    success: true,
    group: updatedGroup,
    assignment: {
      groupId: updatedGroup.groupId,
      advisorId: updatedGroup.advisorId,
      advisorStatus: updatedGroup.advisorStatus,
      assignedAt: updatedGroup.advisorUpdatedAt,
    },
  };
}

/**
 * ADVISOR RELEASE - Process 3.5 (f08: 3.5 → D2 — release path)
 */

/**
 * Release advisor from group.
 * Allows Team Leader or Coordinator to remove advisor and make new request.
 *
 * @param {string} groupId - Group identifier
 * @param {object} options - { requesterId, reason? }
 * @returns {Promise<object>} { success: true, group }
 * @throws {Error} with status code for validation failures
 */
async function releaseAdvisor(groupId, options = {}) {
  const { reason } = options;

  // Verify group exists and has assigned advisor
  const group = await Group.findOne({ groupId });
  if (!group) {
    const err = new Error(`Group ${groupId} not found`);
    err.statusCode = 404;
    throw err;
  }

  if (!group.advisorId || group.advisorStatus !== 'assigned') {
    const err = new Error('Group does not have an assigned advisor');
    err.statusCode = 409;
    throw err;
  }

  // Release advisor
  const updatedGroup = await AdvisorAssignmentRepository.releaseAdvisor(groupId);

  return {
    success: true,
    group: updatedGroup,
    release: {
      groupId: updatedGroup.groupId,
      advisorId: null,
      advisorStatus: updatedGroup.advisorStatus,
      releasedAt: updatedGroup.advisorUpdatedAt,
      reason,
    },
  };
}

/**
 * ADVISOR TRANSFER - Process 3.5 (f08: 3.5 → D2 — transfer path)
 */

/**
 * Transfer advisor to new professor.
 * Called by process 3.5 after coordinator (3.6) requests transfer.
 *
 * @param {string} groupId - Group identifier
 * @param {string} newProfessorId - New professor to assign
 * @param {object} options - { coordinatorId?, reason? }
 * @returns {Promise<object>} { success: true, group, transfer }
 * @throws {Error} with status code for validation failures
 */
async function transferAdvisor(groupId, newProfessorId, options = {}) {
  const { reason } = options;

  // Verify group exists and has assigned advisor
  const group = await Group.findOne({ groupId });
  if (!group) {
    const err = new Error(`Group ${groupId} not found`);
    err.statusCode = 404;
    throw err;
  }

  if (!group.advisorId || group.advisorStatus !== 'assigned') {
    const err = new Error('Group does not have an assigned advisor to transfer');
    err.statusCode = 409;
    throw err;
  }

  // Verify new professor exists
  const newProfessor = await User.findOne({ userId: newProfessorId });
  if (!newProfessor) {
    const err = new Error(`New professor ${newProfessorId} not found`);
    err.statusCode = 404;
    throw err;
  }

  // Check for conflicts with new professor
  const conflict = await Group.findOne({
    advisorId: newProfessorId,
    advisorStatus: 'assigned',
    groupId: { $ne: groupId }, // Exclude current group
  });

  if (conflict) {
    const err = new Error(
      `Target professor ${newProfessorId} already has conflicting assignment with group ${conflict.groupId}`
    );
    err.statusCode = 409;
    throw err;
  }

  // Transfer advisor
  const updatedGroup = await AdvisorAssignmentRepository.transferAdvisor(
    groupId,
    newProfessorId
  );

  return {
    success: true,
    group: updatedGroup,
    transfer: {
      groupId: updatedGroup.groupId,
      previousAdvisorId: group.advisorId,
      newAdvisorId: updatedGroup.advisorId,
      advisorStatus: updatedGroup.advisorStatus,
      transferredAt: updatedGroup.advisorUpdatedAt,
      reason,
    },
  };
}

/**
 * GROUP DISBAND - Process 3.7 (f13: 3.7 → D2)
 */

/**
 * Disband groups without assigned advisor.
 * Called by sanitization process 3.7 after deadline.
 *
 * @param {Array<string>} groupIds - Optional list of specific group IDs to disband
 * @returns {Promise<object>} { success: true, disbandedGroups: [], disbandedCount }
 * @throws {Error} with status code for validation failures
 */
async function disbandUnassignedGroups(groupIds = null) {
  let targetGroups;

  if (groupIds && groupIds.length > 0) {
    // Disband specific groups
    targetGroups = await Group.find({
      groupId: { $in: groupIds },
      $or: [
        { advisorId: null },
        { advisorStatus: { $in: [null, 'pending', 'released'] } },
      ],
    });
  } else {
    // Disband all groups without advisor
    targetGroups = await AdvisorAssignmentRepository.getGroupsWithoutAdvisor();
  }

  const disbandedGroups = [];

  for (const group of targetGroups) {
    try {
      const updatedGroup = await AdvisorAssignmentRepository.disbandGroup(
        group.groupId
      );
      disbandedGroups.push({
        groupId: updatedGroup.groupId,
        groupName: updatedGroup.groupName,
        status: updatedGroup.status,
        disbandedAt: updatedGroup.advisorUpdatedAt,
      });
    } catch (err) {
      console.error(`Failed to disband group ${group.groupId}:`, err.message);
    }
  }

  return {
    success: true,
    disbandedGroups,
    disbandedCount: disbandedGroups.length,
    checkedAt: new Date(),
  };
}

/**
 * NOTIFICATION INTEGRATION - Process 3.3 & 3.7
 */

/**
 * Mark notification as triggered for advisor request.
 * Called after successful notification dispatch (Issue #69).
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object>} Updated group document
 */
async function markAdvisorNotificationTriggered(groupId) {
  return AdvisorAssignmentRepository.markNotificationTriggered(groupId);
}

/**
 * QUERY OPERATIONS
 */

/**
 * Get advisor assignment status for a group (read-after-write consistency).
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object|null>} { advisorId, advisorStatus, advisorUpdatedAt }
 */
async function getAdvisorAssignmentStatus(groupId) {
  return AdvisorAssignmentRepository.getAdvisorAssignment(groupId);
}

/**
 * Get all groups assigned to a specific advisor.
 *
 * @param {string} professorId - Professor identifier
 * @returns {Promise<Array>} Array of assigned groups
 */
async function getAdvisorAssignments(professorId) {
  return AdvisorAssignmentRepository.getGroupsByAdvisor(professorId);
}

/**
 * Get advisor request details for a group.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object|null>} Advisor request object
 */
async function getAdvisorRequestDetails(groupId) {
  return AdvisorAssignmentRepository.getAdvisorRequest(groupId);
}

module.exports = {
  // Advisor request creation (Process 3.2)
  validateAndCreateAdvisorRequest,

  // Advisor assignment (Process 3.5)
  approveAndAssignAdvisor,
  releaseAdvisor,
  transferAdvisor,

  // Group disband (Process 3.7)
  disbandUnassignedGroups,

  // Notification integration
  markAdvisorNotificationTriggered,

  // Query operations
  getAdvisorAssignmentStatus,
  getAdvisorAssignments,
  getAdvisorRequestDetails,
};
