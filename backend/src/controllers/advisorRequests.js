const mongoose = require('mongoose');
const AdvisorRequest = require('../models/AdvisorRequest');
const Group = require('../models/Group');
const { createAuditLog } = require('../services/auditService');

const createHttpError = (status, code, message, extra = {}) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return Object.assign(error, extra);
};

const listProfessorPendingRequests = async (req, res) => {
  try {
    const professorId = req.user.userId;
    const requests = await AdvisorRequest.find({
      professorId,
      status: 'pending',
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      requests: requests.map((item) => ({
        requestId: item.requestId,
        groupId: item.groupId,
        professorId: item.professorId,
        requesterId: item.requesterId,
        status: item.status,
        message: item.message || '',
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    console.error('listProfessorPendingRequests error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

const decideAdvisorRequest = async (req, res) => {
  let responsePayload = null;
  const session = await mongoose.startSession();

  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;

    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'decision must be "approve" or "reject"',
      });
    }

    const now = new Date();

    await session.withTransaction(async () => {
      const advisorRequest = await AdvisorRequest.findOne({ requestId }).session(session);
      if (!advisorRequest) {
        throw createHttpError(404, 'REQUEST_NOT_FOUND', 'Advisor request not found');
      }

      if (advisorRequest.professorId !== req.user.userId) {
        throw createHttpError(403, 'FORBIDDEN', 'Only the professor named in this request can decide it');
      }

      if (advisorRequest.status !== 'pending') {
        throw createHttpError(409, 'REQUEST_ALREADY_PROCESSED', `Request has already been processed as ${advisorRequest.status}`, {
          currentStatus: advisorRequest.status,
        });
      }

      const group = await Group.findOne({ groupId: advisorRequest.groupId }).session(session);
      if (!group) {
        throw createHttpError(404, 'GROUP_NOT_FOUND', 'Group not found');
      }

      let assignedGroupId = null;
      if (decision === 'approve') {
        if (group.advisorId && group.advisorId !== advisorRequest.professorId) {
          throw createHttpError(409, 'GROUP_ALREADY_HAS_ADVISOR', 'Group already has an assigned advisor');
        }

        group.advisorId = advisorRequest.professorId;
        await group.save({ session });
        advisorRequest.status = 'approved';
        assignedGroupId = advisorRequest.groupId;
      } else {
        advisorRequest.status = 'rejected';
      }

      advisorRequest.reason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
      advisorRequest.processedAt = now;
      await advisorRequest.save({ session });

      responsePayload = {
        requestId: advisorRequest.requestId,
        decision,
        approvalStatus: advisorRequest.status === 'approved' ? 'approved' : 'rejected',
        assignedGroupId,
        professorId: advisorRequest.professorId,
        groupId: advisorRequest.groupId,
        reason: advisorRequest.reason,
        processedAt: now.toISOString(),
      };
    });

    try {
      await createAuditLog({
        action: decision === 'approve' ? 'advisor_approved' : 'advisor_rejected',
        actorId: req.user.userId,
        targetId: responsePayload.requestId,
        groupId: responsePayload.groupId,
        payload: {
          request_id: responsePayload.requestId,
          decision,
          approval_status: responsePayload.approvalStatus,
          reason: responsePayload.reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('advisor decision audit log failed (non-fatal):', auditError.message);
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('decideAdvisorRequest error:', error);
    if (error?.status && error?.code) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
        ...(error.currentStatus ? { currentStatus: error.currentStatus } : {}),
      });
    }

    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  listProfessorPendingRequests,
  decideAdvisorRequest,
};
