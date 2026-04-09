const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const { createAuditLog } = require('./auditService');

/**
 * AdvisorServiceError — Custom error for advisor operations.
 */
class AdvisorServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AdvisorServiceError';
    this.status = status;
    this.code = code;
  }
}

/**
 * approveAdvisorRequest(groupId, requestId, professorId, approverId)
 *
 * Process 3.5 (Approval Path):
 *   1. Validate group and request exist
 *   2. Set advisorId = professorId, advisorStatus = 'assigned'
 *   3. Create AdvisorAssignment record (status='assigned')
 *   4. Create audit log entry (status_transition action)
 *   5. Return updated assignment data
 *
 * Throws:
 *   - 404 if group/request not found
 *   - 409 if request already processed or group already has advisor
 */
async function approveAdvisorRequest(groupId, requestId, professorId, approverId) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
  }

  if (!group.advisorRequest || group.advisorRequest.requestId !== requestId) {
    throw new AdvisorServiceError(404, 'REQUEST_NOT_FOUND', 'Advisor request not found');
  }

  if (group.advisorRequest.status !== 'pending') {
    throw new AdvisorServiceError(
      409,
      'REQUEST_ALREADY_PROCESSED',
      `Request already ${group.advisorRequest.status}`
    );
  }

  if (group.advisorId) {
    throw new AdvisorServiceError(
      409,
      'GROUP_ALREADY_HAS_ADVISOR',
      'Group already has an assigned advisor'
    );
  }

  // Update Group
  group.advisorId = professorId;
  group.advisorStatus = 'assigned';
  group.advisorUpdatedAt = new Date();
  group.advisorRequest.status = 'approved';
  group.advisorRequest.approvedAt = new Date();
  await group.save();

  // Create AdvisorAssignment record
  const assignment = new AdvisorAssignment({
    groupId,
    professorId,
    status: 'assigned',
    updatedBy: approverId,
  });
  await assignment.save();

  // Create audit log
  await createAuditLog({
    action: 'status_transition',
    userId: approverId,
    resourceType: 'advisor_assignment',
    resourceId: groupId,
    changeDetails: {
      field: 'advisorStatus',
      oldValue: null,
      newValue: 'assigned',
      professorId,
    },
  });

  return {
    groupId,
    professorId,
    status: 'assigned',
    updatedAt: group.advisorUpdatedAt,
  };
}

/**
 * releaseAdvisor(groupId, releasedBy, reason)
 *
 * Process 3.5 (Release Path):
 *   1. Validate group exists and has an advisor
 *   2. Clear advisorId, set advisorStatus = 'released'
 *   3. Create AdvisorAssignment record (status='released', previousProfessorId set)
 *   4. Create audit log entry
 *   5. Return release confirmation
 *
 * Throws:
 *   - 404 if group not found
 *   - 409 if group has no assigned advisor
 */
async function releaseAdvisor(groupId, releasedBy, reason = '') {
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
  }

  if (!group.advisorId) {
    throw new AdvisorServiceError(409, 'NO_ADVISOR_ASSIGNED', 'Group has no assigned advisor');
  }

  const previousProfessorId = group.advisorId;

  // Update Group
  group.advisorId = null;
  group.advisorStatus = 'released';
  group.advisorUpdatedAt = new Date();
  await group.save();

  // Create AdvisorAssignment record
  const assignment = new AdvisorAssignment({
    groupId,
    previousProfessorId,
    status: 'released',
    updatedBy: releasedBy,
    reason,
  });
  await assignment.save();

  // Create audit log
  await createAuditLog({
    action: 'status_transition',
    userId: releasedBy,
    resourceType: 'advisor_assignment',
    resourceId: groupId,
    changeDetails: {
      field: 'advisorStatus',
      oldValue: 'assigned',
      newValue: 'released',
      previousProfessorId,
      reason,
    },
  });

  return {
    groupId,
    professorId: null,
    status: 'released',
    updatedAt: group.advisorUpdatedAt,
  };
}

/**
 * transferAdvisor(groupId, newProfessorId, transferredBy, reason)
 *
 * Process 3.5/3.6 (Transfer Path):
 *   1. Validate group exists and has an advisor
 *   2. Validate new professor is different
 *   3. Update advisorId to newProfessorId, advisorStatus = 'transferred'
 *   4. Create AdvisorAssignment record (status='transferred', previousProfessorId set)
 *   5. Create audit log entry
 *   6. Return transfer confirmation
 *
 * Throws:
 *   - 404 if group not found
 *   - 409 if group has no advisor or new professor is same as current
 */
async function transferAdvisor(groupId, newProfessorId, transferredBy, reason = '') {
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
  }

  if (!group.advisorId) {
    throw new AdvisorServiceError(409, 'NO_ADVISOR_ASSIGNED', 'Group has no assigned advisor');
  }

  if (group.advisorId === newProfessorId) {
    throw new AdvisorServiceError(
      409,
      'SAME_ADVISOR',
      'New advisor is the same as current advisor'
    );
  }

  const previousProfessorId = group.advisorId;

  // Update Group
  group.advisorId = newProfessorId;
  group.advisorStatus = 'transferred';
  group.advisorUpdatedAt = new Date();
  await group.save();

  // Create AdvisorAssignment record
  const assignment = new AdvisorAssignment({
    groupId,
    professorId: newProfessorId,
    previousProfessorId,
    status: 'transferred',
    updatedBy: transferredBy,
    reason,
  });
  await assignment.save();

  // Create audit log
  await createAuditLog({
    action: 'status_transition',
    userId: transferredBy,
    resourceType: 'advisor_assignment',
    resourceId: groupId,
    changeDetails: {
      field: 'advisorStatus',
      oldValue: 'assigned',
      newValue: 'transferred',
      previousProfessorId,
      newProfessorId,
      reason,
    },
  });

  return {
    groupId,
    professorId: newProfessorId,
    status: 'transferred',
    updatedAt: group.advisorUpdatedAt,
  };
}

module.exports = {
  approveAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  AdvisorServiceError,
};
