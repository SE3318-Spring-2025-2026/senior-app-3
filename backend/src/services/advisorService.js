const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const User = require('../models/User');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('./auditService');
const { v4: uuidv4 } = require('uuid');

/**
 * Custom error class for advisor service errors
 */
class AdvisorServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'AdvisorServiceError';
  }
}

/**
 * Approve an advisor request and assign the professor to the group.
 * Updates D2 (Group model) with advisorId and advisorStatus: assigned.
 * Creates AdvisorAssignment record for historical tracking.
 * Called by Process 3.5 after approval signal from Process 3.4.
 *
 * @param {string} groupId - Target group ID
 * @param {string} requestId - Advisor request ID to approve
 * @param {string} professorId - Professor approving (must match request)
 * @param {string} approverId - Professor user ID (requester of approval)
 * @param {object} options - { ipAddress, userAgent }
 * @returns {object} { groupId, professorId, status, updatedAt }
 */
const approveAdvisorRequest = async (groupId, requestId, professorId, approverId, options = {}) => {
  try {
    // Fetch group and validate advisor request exists
    const group = await Group.findOne({ groupId });
    if (!group) {
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    if (!group.advisorRequest) {
      throw new AdvisorServiceError(404, 'NO_ADVISOR_REQUEST', 'No advisor request found for this group');
    }

    if (group.advisorRequest.requestId !== requestId) {
      throw new AdvisorServiceError(404, 'REQUEST_ID_MISMATCH', 'Request ID does not match group advisory request');
    }

    if (group.advisorRequest.status !== 'pending') {
      throw new AdvisorServiceError(409, 'REQUEST_ALREADY_PROCESSED', `Request has already been ${group.advisorRequest.status}`);
    }

    // Validate professor matches
    if (group.advisorRequest.professorId !== professorId) {
      throw new AdvisorServiceError(403, 'PROFESSOR_MISMATCH', 'Professor ID does not match the request');
    }

    // Check professor exists and is active
    const professor = await User.findOne({ userId: professorId });
    // eslint-disable-next-line no-unsafe-optional-chaining
    if (!professor || professor?.role !== 'professor' || professor?.accountStatus !== 'active') {
      throw new AdvisorServiceError(409, 'PROFESSOR_INVALID', 'Professor is not active or does not exist');
    }

    // Update group with assigned advisor
    const now = new Date();
    group.advisorId = professorId;
    group.advisorStatus = 'assigned';
    group.advisorUpdatedAt = now;
    group.advisorRequest.status = 'approved';
    group.advisorRequest.approvedAt = now;
    await group.save();

    // Create AdvisorAssignment record for tracking
    const assignment = await AdvisorAssignment.create({
      assignmentId: `asn_${uuidv4().split('-')[0]}`,
      groupId,
      professorId,
      status: 'assigned',
      updatedAt: now,
      updatedBy: approverId,
      reason: 'Advisor approved the assignment request',
    });

    // Create audit log
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: approverId,
        groupId,
        payload: {
          previous_status: null,
          new_status: 'assigned',
          reason: 'Advisor approved request and was assigned to group',
          requestId,
          assignmentId: assignment.assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    return {
      groupId,
      professorId,
      status: 'assigned',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof AdvisorServiceError) {
      throw error;
    }
    console.error('advisorService.approveAdvisorRequest error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while approving the advisor request');
  }
};

/**
 * Release an assigned advisor from a group.
 * Clears advisorId and sets advisorStatus: released.
 * Creates AdvisorAssignment record with released status.
 * Called by Process 3.5 after release signal (DELETE /groups/:groupId/advisor).
 *
 * @param {string} groupId - Target group ID
 * @param {string} releasedBy - User ID initiating release
 * @param {string} reason - Reason for release (optional)
 * @param {object} options - { ipAddress, userAgent }
 * @returns {object} { groupId, professorId, status, updatedAt }
 */
const releaseAdvisor = async (groupId, releasedBy, reason = null, options = {}) => {
  try {
    // Fetch group
    const group = await Group.findOne({ groupId });
    if (!group) {
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    if (!group.advisorId) {
      throw new AdvisorServiceError(409, 'NO_ADVISOR_ASSIGNED', 'Group does not have an assigned advisor');
    }

    const previousAdvisorId = group.advisorId;
    const now = new Date();

    // Update group to release advisor
    group.advisorId = null;
    group.advisorStatus = 'released';
    group.advisorUpdatedAt = now;
    await group.save();

    // Create AdvisorAssignment record for tracking
    const assignment = await AdvisorAssignment.create({
      assignmentId: `asn_${uuidv4().split('-')[0]}`,
      groupId,
      professorId: previousAdvisorId,
      status: 'released',
      updatedAt: now,
      updatedBy: releasedBy,
      reason: reason || 'Advisor released from group',
    });

    // Create audit log
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: releasedBy,
        groupId,
        payload: {
          previous_status: 'assigned',
          new_status: 'released',
          reason: reason || 'Advisor released',
          previousAdvisorId,
          assignmentId: assignment.assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    return {
      groupId,
      professorId: null,
      status: 'released',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof AdvisorServiceError) {
      throw error;
    }
    console.error('advisorService.releaseAdvisor error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while releasing the advisor');
  }
};

/**
 * Transfer a group from its current advisor to a new professor.
 * Updates advisorId with new professor and sets advisorStatus: transferred.
 * Creates AdvisorAssignment record with transferred status.
 * Called by Process 3.5 after transfer signal from Process 3.6 (coordinator).
 *
 * @param {string} groupId - Target group ID
 * @param {string} newProfessorId - New professor to assign
 * @param {string} transferredBy - Coordinator user ID initiating transfer
 * @param {string} reason - Reason for transfer (optional)
 * @param {object} options - { ipAddress, userAgent }
 * @returns {object} { groupId, professorId, status, updatedAt }
 */
const transferAdvisor = async (groupId, newProfessorId, transferredBy, reason = null, options = {}) => {
  try {
    // Fetch group
    const group = await Group.findOne({ groupId });
    if (!group) {
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    const previousAdvisorId = group.advisorId;

    // Validate new professor exists and is active
    const professor = await User.findOne({ userId: newProfessorId });
    // eslint-disable-next-line no-unsafe-optional-chaining
    if (!professor || professor?.role !== 'professor' || professor?.accountStatus !== 'active') {
      throw new AdvisorServiceError(409, 'PROFESSOR_INVALID', 'New professor is not active or does not exist');
    }

    // Check for conflict: new professor not already assigned to another group
    const existingAssignment = await Group.findOne({
      advisorId: newProfessorId,
      groupId: { $ne: groupId },
      status: 'active',
    });

    if (existingAssignment) {
      throw new AdvisorServiceError(409, 'PROFESSOR_ALREADY_ASSIGNED', 'Professor is already assigned to another active group');
    }

    const now = new Date();

    // Update group with new advisor
    group.advisorId = newProfessorId;
    group.advisorStatus = 'transferred';
    group.advisorUpdatedAt = now;
    await group.save();

    // Create AdvisorAssignment record for tracking
    const assignment = await AdvisorAssignment.create({
      assignmentId: `asn_${uuidv4().split('-')[0]}`,
      groupId,
      professorId: newProfessorId,
      previousProfessorId: previousAdvisorId,
      status: 'transferred',
      updatedAt: now,
      updatedBy: transferredBy,
      reason: reason || 'Coordinator transferred advisor',
    });

    // Create audit log
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: transferredBy,
        groupId,
        payload: {
          previous_status: previousAdvisorId ? 'assigned' : 'none',
          new_status: 'transferred',
          reason: reason || 'Coordinator transferred advisor',
          previousAdvisorId,
          newAdvisorId: newProfessorId,
          assignmentId: assignment.assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    return {
      groupId,
      professorId: newProfessorId,
      status: 'transferred',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof AdvisorServiceError) {
      throw error;
    }
    console.error('advisorService.transferAdvisor error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while transferring the advisor');
  }
};

module.exports = {
  approveAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  AdvisorServiceError,
};
