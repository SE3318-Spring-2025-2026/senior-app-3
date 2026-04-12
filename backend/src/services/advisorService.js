const mongoose = require('mongoose');
const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const User = require('../models/User');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('./auditService');
const { v4: uuidv4 } = require('uuid');

/**
 * AdvisorServiceError — Custom error class for advisor service operations.
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
 * approveAdvisorRequest(groupId, requestId, professorId, approverId, options)
 * Process 3.5: Approves a request and assigns professor to group.
 * * Issue #64 Fix #2: CRITICAL - Uses Mongoose transaction for atomicity.
 */
const approveAdvisorRequest = async (groupId, requestId, professorId, approverId, options = {}) => {
  const session = await Group.startSession();
  session.startTransaction();
  
  try {
    const group = await Group.findOne({ groupId }).session(session);
    if (!group) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    if (!group.advisorRequest || group.advisorRequest.requestId !== requestId) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'REQUEST_NOT_FOUND', 'Advisor request not found');
    }

    if (group.advisorRequest.status !== 'pending') {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'REQUEST_ALREADY_PROCESSED', `Request has already been ${group.advisorRequest.status}`);
    }

    // Validate professor exists and is active
    const professor = await User.findOne({ userId: professorId }).session(session);
    if (!professor || professor?.role !== 'professor' || professor?.accountStatus !== 'active') {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'PROFESSOR_INVALID', 'Professor is not active or does not exist');
    }

    // Update Group
    const now = new Date();
    group.advisorId = professorId;
    group.advisorStatus = 'assigned';
    group.advisorUpdatedAt = now;
    group.advisorRequest.status = 'approved';
    group.advisorRequest.approvedAt = now;
    await group.save({ session });

    // Create AdvisorAssignment within same transaction
    const assignment = await AdvisorAssignment.create(
      [
        {
          assignmentId: `asn_${uuidv4().split('-')[0]}`,
          groupRef: group._id,
          groupId,
          advisorId: professorId,
          status: 'assigned',
          assignedAt: now,
          updatedBy: approverId,
          releaseReason: 'Advisor approved the assignment request',
        },
      ],
      { session }
    );

    // Audit Log (non-fatal)
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: approverId,
        groupId,
        payload: {
          previous_status: null,
          new_status: 'assigned',
          requestId,
          assignmentId: assignment[0].assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    await session.commitTransaction();

    return {
      groupId,
      professorId,
      status: 'assigned',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AdvisorServiceError) throw error;
    console.error('advisorService.approveAdvisorRequest error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while approving the advisor request');
  } finally {
    session.endSession();
  }
};

/**
 * releaseAdvisor(groupId, releasedBy, reason, options)
 * Process 3.5 (Release Path): Atomically clears advisorId and logs the history.
 */
const releaseAdvisor = async (groupId, releasedBy, reason = null, options = {}) => {
  const session = await Group.startSession();
  session.startTransaction();
  
  try {
    const group = await Group.findOne({ groupId }).session(session);
    if (!group) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    if (!group.advisorId) {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'NO_ADVISOR_ASSIGNED', 'Group does not have an assigned advisor');
    }

    const previousAdvisorId = group.advisorId;
    const now = new Date();

    group.advisorId = null;
    group.advisorStatus = 'released';
    group.advisorUpdatedAt = now;
    await group.save({ session });

    const assignment = await AdvisorAssignment.create(
      [
        {
          assignmentId: `asn_${uuidv4().split('-')[0]}`,
          groupRef: group._id,
          groupId,
          advisorId: previousAdvisorId,
          status: 'released',
          assignedAt: group.advisorUpdatedAt,
          releasedAt: now,
          releasedBy,
          releaseReason: reason || 'Advisor released from group',
        },
      ],
      { session }
    );

    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: releasedBy,
        groupId,
        payload: {
          previous_status: 'assigned',
          new_status: 'released',
          previousAdvisorId,
          assignmentId: assignment[0].assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    await session.commitTransaction();

    return {
      groupId,
      advisorId: null,
      status: 'released',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AdvisorServiceError) throw error;
    console.error('advisorService.releaseAdvisor error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while releasing the advisor');
  } finally {
    session.endSession();
  }
};

/**
 * transferAdvisor(groupId, newProfessorId, transferredBy, reason, options)
 * Process 3.6 (Transfer Path): Reassigns group from one advisor to another.
 * * Issue #64 Fix #4: Ensures a transfer can only happen if an advisor exists.
 */
const transferAdvisor = async (groupId, newProfessorId, transferredBy, reason = null, options = {}) => {
  const session = await Group.startSession();
  session.startTransaction();

  try {
    const group = await Group.findOne({ groupId }).session(session);
    if (!group) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    if (!group.advisorId) {
      await session.abortTransaction();
      throw new AdvisorServiceError(
        409,
        'NO_ADVISOR_TO_TRANSFER',
        'Cannot transfer: group does not have an assigned advisor.'
      );
    }

    const previousAdvisorId = group.advisorId;

    const professor = await User.findOne({ userId: newProfessorId }).session(session);
    if (!professor || professor?.role !== 'professor' || professor?.accountStatus !== 'active') {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'PROFESSOR_INVALID', 'New professor is inactive or does not exist');
    }

    const now = new Date();
    group.advisorId = newProfessorId;
    group.advisorStatus = 'transferred';
    group.advisorUpdatedAt = now;
    await group.save({ session });

    await AdvisorAssignment.create(
      [
        {
          assignmentId: `asn_${uuidv4().split('-')[0]}`,
          groupRef: group._id,
          groupId,
          advisorId: newProfessorId,
          previousAdvisorId: previousAdvisorId,
          status: 'transferred',
          assignedAt: group.advisorUpdatedAt,
          releasedBy: transferredBy,
          releaseReason: reason || 'Coordinator transferred advisor',
        },
      ],
      { session }
    );

    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: transferredBy,
        groupId,
        payload: {
          previous_status: 'assigned',
          new_status: 'transferred',
          previousAdvisorId,
          newAdvisorId: newProfessorId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    await session.commitTransaction();

    return {
      groupId,
      advisorId: newProfessorId,
      status: 'transferred',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AdvisorServiceError) throw error;
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while transferring the advisor');
  } finally {
    session.endSession();
  }
};

module.exports = {
  approveAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  AdvisorServiceError,
};