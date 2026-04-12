/**
 * AdvisorAssignmentService
 *
 * Business logic layer for advisor assignment operations.
 * Orchestrates write operations from processes 3.2, 3.3, 3.5, 3.6, and 3.7.
 * Implements transaction-safe operations, conflict detection, and performance optimizations.
 * * Issue #61 & #68 Consolidation
 */

const Group = require('../models/Group');
const User = require('../models/User');
const AdvisorRequest = require('../models/AdvisorRequest');
// Repository patterns from feature/68 are preserved for complex mutations
const AdvisorAssignmentRepository = require('../repositories/AdvisorAssignmentRepository');
const { sendAdviseeRequestNotification } = require('./adviseeNotificationService');

/**
 * Custom error class for standardized advisor assignment exceptions
 */
class AdvisorAssignmentError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AdvisorAssignmentError';
    this.status = status;
  }
}

/**
 * SHARED VALIDATION: Parallel entity validation (Fix #2 & #6)
 * Optimized with .lean() to reduce memory overhead.
 */
const validateGroupAndProfessor = async (groupId, professorId) => {
  const [group, professor] = await Promise.all([
    Group.findOne({ groupId }).lean(),
    User.findOne({ userId: professorId }).lean(),
  ]);

  if (!group) {
    throw new AdvisorAssignmentError(`Group ${groupId} not found in D2`, 404);
  }

  if (!professor) {
    throw new AdvisorAssignmentError(`Professor ${professorId} not found in D1`, 404);
  }

  return { group, professor };
};

/**
 * ADVISOR REQUEST CREATION - Process 3.2 (f03: 3.2 → D2)
 */
async function validateAndCreateAdvisorRequest(requestData) {
  const { groupId, professorId, requesterId, message } = requestData;

  // Parallel validation check
  const { group } = await validateGroupAndProfessor(groupId, professorId);

  // Conflict Detection: Check if group has advisor or active request
  if (group.advisorId) {
    throw new AdvisorAssignmentError('Group already has an assigned advisor', 409);
  }

  // Fast-fail check for pending requests (Database index also enforces this)
  const existingPendingRequest = await AdvisorRequest.findOne({
    groupId,
    status: 'pending',
  }).lean();

  if (existingPendingRequest) {
    throw new AdvisorAssignmentError('Group already has a pending advisor request', 409);
  }

  // Create advisor request record (flow f03)
  const requestId = `ADVREQ_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  let advisorRequest;

  try {
    advisorRequest = new AdvisorRequest({
      requestId,
      groupId,
      professorId,
      requesterId,
      message: message || '',
      status: 'pending',
    });

    await advisorRequest.save();
  } catch (error) {
    // Catch E11000 duplicate key error from unique partial index (Fix #5)
    if (error.code === 11000) {
      throw new AdvisorAssignmentError('Group already has a pending advisor request (Race condition prevented)', 409);
    }
    throw error;
  }

  /**
   * Process 3.3: Fire-and-forget notification (Fix #3)
   * 201 returns immediately; notification service updates D2 in background.
   */
  sendAdviseeRequestNotification(
    { requestId, groupId, professorId, requesterId, message: message || '' },
    requesterId
  ).catch((error) => {
    console.error('Notification dispatch failed in background', error);
  });

  return {
    success: true,
    requestId: advisorRequest.requestId,
    groupId: advisorRequest.groupId,
    professorId: advisorRequest.professorId,
    status: advisorRequest.status,
    notificationTriggered: false // Will be updated by background task
  };
}

/**
 * ADVISOR ASSIGNMENT - Process 3.5 (f08: 3.5 → D2 — assign path)
 */
async function approveAndAssignAdvisor(groupId, requestId, options = {}) {
  const { professorId } = options;

  const { group } = await validateGroupAndProfessor(groupId, professorId);

  if (!group.advisorRequest?.requestId || group.advisorRequest.requestId !== requestId) {
    throw new AdvisorAssignmentError('No matching advisor request found for this group', 404);
  }

  if (group.advisorRequest.status !== 'pending') {
    throw new AdvisorAssignmentError(`Advisor request has already been processed: ${group.advisorRequest.status}`, 409);
  }

  // Assign advisor via repository to handle transaction-safe logic
  const updatedGroup = await AdvisorAssignmentRepository.assignAdvisor(
    groupId,
    professorId,
    { requestId }
  );

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
async function releaseAdvisor(groupId, options = {}) {
  const { reason } = options;

  const group = await Group.findOne({ groupId }).lean();
  if (!group) throw new AdvisorAssignmentError(`Group ${groupId} not found`, 404);

  if (!group.advisorId || group.advisorStatus !== 'assigned') {
    throw new AdvisorAssignmentError('Group does not have an assigned advisor', 409);
  }

  const updatedGroup = await AdvisorAssignmentRepository.releaseAdvisor(groupId);

  return {
    success: true,
    group: updatedGroup,
    release: {
      groupId: updatedGroup.groupId,
      advisorStatus: updatedGroup.advisorStatus,
      releasedAt: updatedGroup.advisorUpdatedAt,
      reason,
    },
  };
}

/**
 * ADVISOR TRANSFER - Process 3.5 (f08: 3.5 → D2 — transfer path)
 */
async function transferAdvisor(groupId, newProfessorId, options = {}) {
  const { reason } = options;

  const { group } = await validateGroupAndProfessor(groupId, newProfessorId);

  if (!group.advisorId || group.advisorStatus !== 'assigned') {
    throw new AdvisorAssignmentError('Group does not have an assigned advisor to transfer', 409);
  }

  // Conflict check for the new professor
  const conflict = await Group.findOne({
    advisorId: newProfessorId,
    advisorStatus: 'assigned',
    groupId: { $ne: groupId },
  }).lean();

  if (conflict) {
    throw new AdvisorAssignmentError(`Target professor ${newProfessorId} already assigned to group ${conflict.groupId}`, 409);
  }

  const updatedGroup = await AdvisorAssignmentRepository.transferAdvisor(groupId, newProfessorId);

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
async function disbandUnassignedGroups(groupIds = null) {
  let targetGroups;

  if (groupIds && groupIds.length > 0) {
    targetGroups = await Group.find({
      groupId: { $in: groupIds },
      $or: [
        { advisorId: null },
        { advisorStatus: { $in: [null, 'pending', 'released'] } },
      ],
    }).lean();
  } else {
    targetGroups = await AdvisorAssignmentRepository.getGroupsWithoutAdvisor();
  }

  const disbandedGroups = [];

  for (const group of targetGroups) {
    try {
      const updatedGroup = await AdvisorAssignmentRepository.disbandGroup(group.groupId);
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
 * NOTIFICATION INTEGRATION - Mark triggered after Process 3.3 succeeds
 */
async function markAdvisorNotificationTriggered(groupId) {
  return AdvisorAssignmentRepository.markNotificationTriggered(groupId);
}

/**
 * QUERY OPERATIONS
 */
async function getAdvisorAssignmentStatus(groupId) {
  return AdvisorAssignmentRepository.getAdvisorAssignment(groupId);
}

async function getAdvisorAssignments(professorId) {
  return AdvisorAssignmentRepository.getGroupsByAdvisor(professorId);
}

async function getAdvisorRequestDetails(groupId) {
  return AdvisorAssignmentRepository.getAdvisorRequest(groupId);
}

module.exports = {
  validateAndCreateAdvisorRequest,
  approveAndAssignAdvisor,
  releaseAdvisor,
  transferAdvisor,
  disbandUnassignedGroups,
  markAdvisorNotificationTriggered,
  getAdvisorAssignmentStatus,
  getAdvisorAssignments,
  getAdvisorRequestDetails,
  validateGroupAndProfessor,
  AdvisorAssignmentError
};