const Group = require('../models/Group');
const User = require('../models/User');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('../services/auditService');
const {
  approveAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  AdvisorServiceError,
} = require('../services/advisorService');
const { dispatchAdvisorStatusNotification } = require('../services/notificationService');

/**
 * Helper to validate advisor request and professor status.
 * * Issue #64 Fix #1: CRITICAL - Query professor from database BEFORE evaluating 
 * account status to prevent assignment to inactive/invalid accounts.
 */
const validateAdvisorDecisionInputs = async (requestId, professorId) => {
  const group = await Group.findOne({ 'advisorRequest.requestId': requestId });

  if (!group) {
    return {
      group: null,
      error: { status: 404, code: 'REQUEST_NOT_FOUND', message: 'Advisor request not found' },
    };
  }

  const { advisorRequest } = group;

  // Authorization: only the requested professor can decide
  if (advisorRequest.professorId !== professorId) {
    return {
      group: null,
      error: { status: 403, code: 'NOT_REQUESTED_PROFESSOR', message: 'Only the requested professor can respond' },
    };
  }

  if (advisorRequest.status !== 'pending') {
    return {
      group: null,
      error: { status: 409, code: 'REQUEST_ALREADY_PROCESSED', message: `Already ${advisorRequest.status}` },
    };
  }

  // Issue #64 Fix #1: Verify professor exists and is active
  const professor = await User.findOne({ userId: professorId });
  if (!professor || professor.accountStatus !== 'active') {
    return {
      group: null,
      error: { status: 409, code: 'PROFESSOR_ACCOUNT_INACTIVE', message: 'Professor account is not active' },
    };
  }

  return { group, professor, error: null };
};

/**
 * Helper to dispatch notification with retry logic (non-fatal).
 */
const dispatchApprovalNotification = async (group, professor, professorId) => {
  let notifLastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await dispatchAdvisorStatusNotification({
        groupId: group.groupId,
        groupName: group.groupName,
        professorId,
        professorName: professor.firstName ? `${professor.firstName} ${professor.lastName}` : professor.email,
        status: 'assigned',
        recipientId: group.leaderId,
        message: 'Your advisor request has been approved',
      });
      notifLastError = null;
      break;
    } catch (err) {
      notifLastError = err;
    }
  }
  return notifLastError;
};

/**
 * PATCH /api/v1/advisor-requests/:requestId
 * Process 3.4: Professor approves or rejects advisee request.
 */
const advisorApproveRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;
    const professorId = req.user.userId;

    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ code: 'INVALID_DECISION', message: 'Decision must be approve/reject' });
    }

    const { group, professor, error: vErr } = await validateAdvisorDecisionInputs(requestId, professorId);
    if (vErr) return res.status(vErr.status).json({ code: vErr.code, message: vErr.message });

    const now = new Date();

    if (decision === 'approve') {
      try {
        await approveAdvisorRequest(group.groupId, requestId, professorId, professorId, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        const notifErr = await dispatchApprovalNotification(group, professor, professorId);
        if (notifErr) {
          await SyncErrorLog.create({
            service: 'notification',
            groupId: group.groupId,
            actorId: professorId,
            attempts: 3,
            lastError: notifErr.message,
          }).catch(e => console.error('SyncLog failed:', e.message));
        }

        return res.status(200).json({
          requestId,
          groupId: group.groupId,
          decision: 'approve',
          status: 'approved',
          advisorId: professorId,
          assignedAt: now.toISOString(),
        });
      } catch (serviceErr) {
        if (serviceErr instanceof AdvisorServiceError) {
          return res.status(serviceErr.status).json({ code: serviceErr.code, message: serviceErr.message });
        }
        throw serviceErr;
      }
    } else {
      // Rejection logic
      group.advisorRequest.status = 'rejected';
      await group.save();

      await createAuditLog({
        action: 'advisor_request_rejected',
        actorId: professorId,
        groupId: group.groupId,
        payload: { requestId, reason: reason || null },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(200).json({
        requestId,
        groupId: group.groupId,
        decision: 'reject',
        status: 'rejected',
        professorId,
        rejectedAt: now.toISOString(),
      });
    }
  } catch (error) {
    console.error('[advisorApproveRequest] Error:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Internal server error' });
  }
};

/**
 * DELETE /api/v1/groups/:groupId/advisor
 * Process 3.5: Release an assigned advisor.
 * * Issue #64 Fix #3: CRITICAL - Updated authorization to only allow Team Leader or Coordinator.
 * Current advisor should NOT have power to unilaterally release themselves per Issue #59.
 */
const releaseAdvisorHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { reason } = req.body;
    const releasedBy = req.user.userId;

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });

    // Authorization Check (Fix #3)
    const isLeader = group.leaderId === releasedBy;
    const user = await User.findOne({ userId: releasedBy });
    const isCoordinator = user?.role === 'coordinator' || user?.role === 'admin';

    if (!isLeader && !isCoordinator) {
      return res.status(403).json({
        code: 'UNAUTHORIZED_RELEASE',
        message: 'Only the group leader or coordinator can release the advisor',
      });
    }

    try {
      const result = await releaseAdvisor(groupId, releasedBy, reason || null, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.status(200).json(result);
    } catch (serviceErr) {
      if (serviceErr instanceof AdvisorServiceError) {
        return res.status(serviceErr.status).json({ code: serviceErr.code, message: serviceErr.message });
      }
      throw serviceErr;
    }
  } catch (error) {
    console.error('[releaseAdvisorHandler] Error:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Internal server error' });
  }
};

/**
 * POST /api/v1/groups/:groupId/advisor/transfer
 * Process 3.6: Coordinator transfers group to a new professor.
 */
const transferAdvisorHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { newProfessorId, reason } = req.body;
    const coordinatorId = req.user.userId;

    if (!newProfessorId) {
      return res.status(400).json({ code: 'MISSING_PROFESSOR_ID', message: 'newProfessorId is required' });
    }

    try {
      const result = await transferAdvisor(groupId, newProfessorId, coordinatorId, reason || null, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.status(200).json(result);
    } catch (serviceErr) {
      if (serviceErr instanceof AdvisorServiceError) {
        return res.status(serviceErr.status).json({ code: serviceErr.code, message: serviceErr.message });
      }
      throw serviceErr;
    }
  } catch (error) {
    console.error('[transferAdvisorHandler] Error:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Internal server error' });
  }
};

module.exports = {
  advisorApproveRequest,
  releaseAdvisorHandler,
  transferAdvisorHandler,
};