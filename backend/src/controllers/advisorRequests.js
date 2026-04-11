const Group = require('../models/Group');
const User = require('../models/User');
const { createAuditLog } = require('../services/auditService');
const {
  dispatchAdvisorRequestNotification,
  dispatchRejectionNotification,
} = require('../services/notificationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
const { markNotificationTriggered } = require('../repositories/AdvisorAssignmentRepository');

const formatAdvisorRequestBody = (group) => {
  const ar = group.advisorRequest;
  return {
    requestId: ar.requestId,
    groupId: group.groupId,
    professorId: ar.professorId,
    requesterId: ar.requestedBy,
    status: ar.status,
    message: ar.message || null,
    notificationTriggered: ar.notificationTriggered,
    createdAt: ar.createdAt ? ar.createdAt.toISOString() : new Date().toISOString(),
  };
};

/**
 * POST /api/v1/groups/advisor-requests — Process 3.1–3.3: leader submits advisee request.
 */
const submitAdviseeRequest = async (req, res) => {
  try {
    const { groupId, professorId, requesterId, message } = req.body;

    if (!groupId || !professorId || !requesterId) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'groupId, professorId, and requesterId are required',
      });
    }

    if (req.user.userId !== requesterId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'requesterId must match the authenticated user',
      });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== requesterId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the team leader can submit an advisor request',
      });
    }

    if (group.status !== 'active') {
      return res.status(409).json({
        code: 'INVALID_GROUP_STATE',
        message: 'Advisor requests can only be submitted for active groups',
      });
    }

    if (group.advisorId) {
      return res.status(409).json({
        code: 'ADVISOR_ALREADY_ASSIGNED',
        message: 'This group already has an assigned advisor',
      });
    }

    if (group.advisorRequest && group.advisorRequest.status === 'pending') {
      return res.status(409).json({
        code: 'PENDING_REQUEST_EXISTS',
        message: 'A pending advisor request already exists for this group',
      });
    }

    const professor = await User.findOne({
      userId: professorId,
      role: 'professor',
      accountStatus: 'active',
    });
    if (!professor) {
      return res.status(404).json({
        code: 'PROFESSOR_NOT_FOUND',
        message: 'Professor not found or inactive',
      });
    }

    group.advisorRequest = {
      professorId,
      requestedBy: requesterId,
      status: 'pending',
      notificationTriggered: false,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await group.save();

    const responseBody = formatAdvisorRequestBody(group);
    const requestIdForNotif = group.advisorRequest.requestId;

    try {
      await createAuditLog({
        action: 'advisor_request_submitted',
        actorId: requesterId,
        targetId: groupId,
        groupId,
        payload: {
          request_id: requestIdForNotif,
          professor_id: professorId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    res.status(201).json(responseBody);

    setImmediate(async () => {
      try {
        const notificationResult = await retryNotificationWithBackoff(
          () =>
            dispatchAdvisorRequestNotification({
              groupId: group.groupId,
              groupName: group.groupName,
              professorId,
              requesterId,
              message: group.advisorRequest.message,
            }),
          {
            maxAttempts: 3,
            initialBackoffMs: 100,
            identifier: requestIdForNotif,
            identifierType: 'requestId',
          }
        );

        if (notificationResult.success) {
          try {
            await markNotificationTriggered(requestIdForNotif);
          } catch (flagErr) {
            console.warn(
              `[AdvisorRequest] Failed to persist notificationTriggered for ${requestIdForNotif}:`,
              flagErr.message
            );
          }
        }
      } catch (bgErr) {
        console.error('[AdvisorRequest] Background notification error:', bgErr.message);
      }
    });
  } catch (err) {
    console.error('submitAdviseeRequest error:', err);
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to submit advisor request',
    });
  }
};

/**
 * PATCH /api/v1/groups/advisor-requests/:requestId — Process 3.4: professor approves or rejects.
 */
const handleAdvisorDecision = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;

    if (!decision || typeof decision !== 'string') {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'decision is required',
      });
    }

    const normalized = decision.toLowerCase().trim();
    if (!['approve', 'reject'].includes(normalized)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'decision must be "approve" or "reject"',
      });
    }

    const group = await Group.findOne({ 'advisorRequest.requestId': requestId });
    if (!group || !group.advisorRequest) {
      return res.status(404).json({
        code: 'REQUEST_NOT_FOUND',
        message: 'Advisor request not found',
      });
    }

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && group.advisorRequest.professorId !== req.user.userId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the assigned professor can respond to this request',
      });
    }

    if (group.advisorRequest.status !== 'pending') {
      return res.status(409).json({
        code: 'REQUEST_ALREADY_PROCESSED',
        message: 'This advisor request has already been processed',
      });
    }

    const rejectionReason =
      typeof reason === 'string' && reason.trim() ? reason.trim() : null;

    const processedAt = new Date();

    if (normalized === 'approve') {
      group.advisorId = group.advisorRequest.professorId;
      group.advisorStatus = 'assigned';
      group.advisorUpdatedAt = processedAt;
      group.advisorRequest.status = 'approved';
      group.advisorRequest.approvedAt = processedAt;
      group.advisorRequest.updatedAt = processedAt;

      await group.save();

      try {
        await createAuditLog({
          action: 'advisor_request_approved',
          actorId: req.user.userId,
          targetId: group.groupId,
          groupId: group.groupId,
          payload: {
            request_id: requestId,
            professor_id: group.advisorRequest.professorId,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
      } catch (auditErr) {
        console.error('Audit log failed (non-fatal):', auditErr.message);
      }

      return res.status(200).json({
        requestId,
        decision: 'approve',
        approvalStatus: 'approved',
        assignedGroupId: group.groupId,
        professorId: group.advisorRequest.professorId,
        processedAt: processedAt.toISOString(),
      });
    }

    // reject
    group.advisorRequest.status = 'rejected';
    group.advisorRequest.updatedAt = processedAt;
    await group.save();

    const responsePayload = {
      requestId,
      decision: 'reject',
      approvalStatus: 'rejected',
      assignedGroupId: null,
      professorId: group.advisorRequest.professorId,
      processedAt: processedAt.toISOString(),
    };

    res.status(200).json(responsePayload);

    const snapshot = {
      groupId: group.groupId,
      groupName: group.groupName,
      teamLeaderId: group.leaderId,
      professorId: group.advisorRequest.professorId,
      requestId: group.advisorRequest.requestId,
      reason: rejectionReason,
    };

    try {
      await createAuditLog({
        action: 'advisor_request_rejected',
        actorId: req.user.userId,
        targetId: group.groupId,
        groupId: group.groupId,
        payload: {
          request_id: requestId,
          professor_id: group.advisorRequest.professorId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    setImmediate(async () => {
      try {
        const notificationResult = await retryNotificationWithBackoff(
          () =>
            dispatchRejectionNotification({
              groupId: snapshot.groupId,
              groupName: snapshot.groupName,
              teamLeaderId: snapshot.teamLeaderId,
              professorId: snapshot.professorId,
              requestId: snapshot.requestId,
              reason: snapshot.reason,
            }),
          {
            maxAttempts: 3,
            initialBackoffMs: 100,
            identifier: requestId,
            identifierType: 'requestId',
          }
        );

        if (notificationResult.success) {
          try {
            await markNotificationTriggered(requestId);
          } catch (flagErr) {
            console.warn(
              `[AdvisorDecision] Failed to persist notificationTriggered for ${requestId}:`,
              flagErr.message
            );
          }
        }
      } catch (bgErr) {
        console.error('[AdvisorDecision] Background rejection notification error:', bgErr.message);
      }
    });
  } catch (err) {
    console.error('handleAdvisorDecision error:', err);
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to process advisor decision',
    });
  }
};

module.exports = {
  submitAdviseeRequest,
  handleAdvisorDecision,
};
