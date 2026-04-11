const mongoose = require('mongoose');
const AdvisorRequest = require('../models/AdvisorRequest');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const Group = require('../models/Group');
const User = require('../models/User');

/**
 * Process 3.2: Validate and store advisee request
 *
 * Logic:
 * - Verify group exists and has no advisor assigned (409 if already assigned)
 * - Prevent duplicate pending requests for the same group (409)
 * - Verify professor exists and has the role 'professor'
 * - Store request to D3 (Advisor Requests)
 */
const submitRequest = async (data) => {
  const { groupId, professorId, requesterId, message } = data;

  // 1. Verify group exists and advisor assignment status
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found' };
  }

  if (group.advisorId) {
    throw { status: 409, code: 'ALREADY_HAS_ADVISOR', message: 'This group already has an assigned advisor.' };
  }

  // 2. Check for duplicate pending request
  const existingRequest = await AdvisorRequest.findOne({
    groupId,
    status: 'pending'
  });

  if (existingRequest) {
    throw { status: 409, code: 'PENDING_REQUEST_EXISTS', message: 'Group already has a pending advisor request.' };
  }

  // 3. Verify professor exists and role
  const professor = await User.findOne({ userId: professorId, role: 'professor' });
  if (!professor) {
    throw { status: 404, code: 'PROFESSOR_NOT_FOUND', message: 'Selected professor not found or invalid role.' };
  }

  // 4. Store the request (Process 3.2 → D3)
  const advisorRequest = new AdvisorRequest({
    groupId,
    professorId,
    requesterId,
    message,
    notificationTriggered: true // Placeholder for Process 3.3
  });

  try {
    await advisorRequest.save();
  } catch (error) {
    if (error.code === 11000) {
      throw { status: 409, code: 'PENDING_REQUEST_EXISTS', message: 'Group already has a pending advisor request.' };
    }
    throw error;
  }

  return advisorRequest;
};

/**
 * Atomically clear the group's advisor and record a released assignment history row.
 */
const releaseAdvisor = async ({ groupId, requesterId, reason }) => {
  if (typeof groupId !== 'string' || !groupId.trim()) {
    throw { status: 400, code: 'INVALID_INPUT', message: 'groupId is required.' };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const group = await Group.findOne({ groupId }).session(session);
    if (!group) {
      throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };
    }

    if (group.leaderId !== requesterId) {
      throw { status: 403, code: 'FORBIDDEN', message: 'Only the Team Leader can release the advisor.' };
    }

    if (!group.advisorId) {
      throw { status: 400, code: 'NO_ADVISOR', message: 'This group does not have an assigned advisor.' };
    }

    const previousAdvisorId = group.advisorId;
    const now = new Date();
    const safeReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

    const approvedRequest = await AdvisorRequest.findOne({
      groupId,
      professorId: previousAdvisorId,
      status: 'approved',
    })
      .sort({ decidedAt: -1, updatedAt: -1 })
      .session(session);

    const resolvedAssignedAt =
      group.advisorAssignedAt ||
      approvedRequest?.decidedAt ||
      approvedRequest?.createdAt ||
      null;

    await Group.findOneAndUpdate(
      { groupId },
      { $set: { advisorId: null, advisorAssignedAt: null } },
      { session }
    );

    const assignmentPayload = {
      groupRef: group._id,
      groupId,
      advisorId: previousAdvisorId,
      status: 'released',
      releasedAt: now,
      releasedBy: requesterId,
      releaseReason: safeReason,
    };
    if (resolvedAssignedAt) {
      assignmentPayload.assignedAt = resolvedAssignedAt;
    }

    await AdvisorAssignment.create([assignmentPayload], { session });

    await session.commitTransaction();
    return { previousAdvisorId };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

module.exports = {
  submitRequest,
  releaseAdvisor,
};
