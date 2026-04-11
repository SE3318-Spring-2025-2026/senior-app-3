const mongoose = require('mongoose');
const AdvisorRequest = require('../models/AdvisorRequest');
const Group = require('../models/Group');
const User = require('../models/User');
const { createAuditLog } = require('../services/auditService');
const { 
  dispatchAdvisorStatusNotification, 
  dispatchRejectionNotification 
} = require('../services/notificationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');

/**
 * Helper to create standardized HTTP errors
 */
const createHttpError = (status, code, message, extra = {}) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return Object.assign(error, extra);
};

/**
 * GET /api/v1/advisor-requests/mine
 * List pending advisor requests for the authenticated professor.
 */
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

/**
 * PATCH /api/v1/advisor-requests/:requestId
 * Professor approves or rejects an advisor request.
 * Implements Process 3.4 (Advisor Decision) and triggers Process 3.5 (Notification).
 */
const decideAdvisorRequest = async (req, res) => {
  let responsePayload = null;
  let notificationData = null;
  const session = await mongoose.startSession();

  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;

    // 1. Validation
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'decision must be "approve" or "reject"',
      });
    }

    const now = new Date();

    // 2. Transactional Update (Process 3.4)
    await session.withTransaction(async () => {
      const advisorRequest = await AdvisorRequest.findOne({ requestId }).session(session);
      if (!advisorRequest) {
        throw createHttpError(404, 'REQUEST_NOT_FOUND', 'Advisor request not found');
      }

      // Authorization check: Only the targeted professor can decide
      if (advisorRequest.professorId !== req.user.userId && req.user.role !== 'admin') {
        throw createHttpError(403, 'FORBIDDEN', 'Only the assigned professor can respond to this request');
      }

      if (advisorRequest.status !== 'pending') {
        throw createHttpError(409, 'REQUEST_ALREADY_PROCESSED', `Request has already been processed as ${advisorRequest.status}`);
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

        // Update Group Record
        group.advisorId = advisorRequest.professorId;
        group.advisorStatus = 'assigned';
        group.advisorUpdatedAt = now;
        group.advisorAssignedAt = now;
        await group.save({ session });

        advisorRequest.status = 'approved';
        assignedGroupId = advisorRequest.groupId;
      } else {
        advisorRequest.status = 'rejected';
      }

      advisorRequest.reason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
      advisorRequest.decidedAt = now;
      advisorRequest.processedAt = now;
      await advisorRequest.save({ session });

      // Prepare data for background notification and response
      notificationData = {
        groupId: group.groupId,
        groupName: group.groupName,
        teamLeaderId: group.leaderId,
        professorId: advisorRequest.professorId,
        requestId: advisorRequest.requestId,
        reason: advisorRequest.reason,
        status: advisorRequest.status
      };

      responsePayload = {
        requestId: advisorRequest.requestId,
        decision,
        approvalStatus: advisorRequest.status,
        assignedGroupId,
        professorId: advisorRequest.professorId,
        processedAt: now.toISOString(),
      };
    });

    // 3. Audit Log (Non-fatal)
    try {
      await createAuditLog({
        action: decision === 'approve' ? 'advisor_request_approved' : 'advisor_request_rejected',
        actorId: req.user.userId,
        targetId: responsePayload.requestId,
        groupId: notificationData.groupId,
        payload: {
          request_id: responsePayload.requestId,
          decision,
          reason: notificationData.reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    // 4. Send Response Immediately
    res.status(200).json(responsePayload);

    // 5. Background Notification (Process 3.5) with Retry Logic (from feature/69)
    setImmediate(async () => {
      try {
        await retryNotificationWithBackoff(
          async () => {
            if (decision === 'approve') {
              return dispatchAdvisorStatusNotification({
                groupId: notificationData.groupId,
                groupName: notificationData.groupName,
                professorId: notificationData.professorId,
                status: 'assigned',
                recipientId: notificationData.teamLeaderId,
              });
            } else {
              return dispatchRejectionNotification({
                groupId: notificationData.groupId,
                groupName: notificationData.groupName,
                teamLeaderId: notificationData.teamLeaderId,
                professorId: notificationData.professorId,
                requestId: notificationData.requestId,
                reason: notificationData.reason,
              });
            }
          },
          {
            maxAttempts: 3,
            initialBackoffMs: 200,
            identifier: requestId,
            identifierType: 'requestId',
          }
        );
      } catch (bgErr) {
        console.error(`[AdvisorDecision] Background notification failed for ${requestId}:`, bgErr.message);
      }
    });

  } catch (error) {
    console.error('decideAdvisorRequest error:', error);
    if (error.status && error.code) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred while processing the decision',
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  listProfessorPendingRequests,
  decideAdvisorRequest,
};