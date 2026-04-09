const Group = require('../models/Group');
const User = require('../models/User');
const { createAuditLog } = require('../services/auditService');
const {
  approveAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  AdvisorServiceError,
} = require('../services/advisorService');
const { dispatchAdvisorStatusNotification } = require('../services/notificationService');
const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Helper to validate advisor request and prepare decision handling.
 * Extracted to reduce cognitive complexity.
 */
const validateAdvisorDecisionInputs = async (requestId, professorId, decision) => {
  // Find group containing this advisor request
  const group = await Group.findOne({
    'advisorRequest.requestId': requestId,
  });

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
      error: { status: 403, code: 'NOT_REQUESTED_PROFESSOR', message: 'Only the requested professor can respond to this request' },
    };
  }

  // Check request status
  if (advisorRequest.status !== 'pending') {
    return {
      group: null,
      error: {
        status: 409,
        code: 'REQUEST_ALREADY_PROCESSED',
        message: `Request has already been ${advisorRequest.status}`,
        currentStatus: advisorRequest.status,
      },
    };
  }

  // Validate professor exists and is active
  // eslint-disable-next-line no-unsafe-optional-chaining
  if (!professor || professor?.accountStatus !== 'active') {
    return {
      group: null,
      error: { status: 409, code: 'PROFESSOR_ACCOUNT_INACTIVE', message: 'Professor account is not active' },
    };
  }

  return { group, error: null };
};

/**
 * Helper to dispatch notification with retry logic (non-fatal).
 */
const dispatchApprovalNotification = async (group, professor, professorId) => {
  let notifLastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      // eslint-disable-next-line @typescript-eslint/await-thenable
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
 *
 * Process 3.4 Decision Handler: Professor approves or rejects advisee request.
 * Only the professor named in the request can respond (403 for others).
 * On approval, triggers Process 3.5 to update D2 with assigned advisor.
 * Validates schedule boundary and request status.
 *
 * @param {string} req.params.requestId - Advisor request ID
 * @param {string} req.body.decision - 'approve' | 'reject'
 * @param {string} req.body.reason - optional reason/comment
 * @returns {200} { requestId, groupId, decision, status, professorId, assignedAt }
 */
const advisorApproveRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;
    const professorId = req.user.userId;

    // Input validation
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'decision must be "approve" or "reject"',
      });
    }

    if (reason && typeof reason !== 'string') {
      return res.status(400).json({
        code: 'INVALID_REASON',
        message: 'reason must be a string',
      });
    }

    // Validate inputs
    const { group, error: validationError } = await validateAdvisorDecisionInputs(requestId, professorId, decision);

    if (validationError) {
      return res.status(validationError.status).json({
        code: validationError.code,
        message: validationError.message,
        ...(validationError.currentStatus && { currentStatus: validationError.currentStatus }),
      });
    }

    const { advisorRequest } = group;
    const now = new Date();

    if (decision === 'approve') {
      // Process 3.5: Approve and assign advisor
      try {
        // eslint-disable-next-line no-await-in-loop
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await approveAdvisorRequest(group.groupId, requestId, professorId, professorId, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        // Fetch professor for notification
        const professor = await User.findOne({ userId: professorId });

        // Dispatch notification (non-fatal)
        const notifLastError = await dispatchApprovalNotification(group, professor, professorId);

        if (notifLastError) {
          try {
            await SyncErrorLog.create({
              service: 'notification',
              groupId: group.groupId,
              actorId: professorId,
              attempts: 3,
              lastError: notifLastError.message,
            });
          } catch (logErr) {
            console.error('SyncErrorLog creation failed (non-fatal):', logErr.message);
          }
        }

        return res.status(200).json({
          requestId,
          groupId: group.groupId,
          decision: 'approve',
          status: 'approved',
          professorId,
          notificationTriggered: !notifLastError,
          assignedAt: now.toISOString(),
        });
      } catch (serviceErr) {
        if (serviceErr instanceof AdvisorServiceError) {
          return res.status(serviceErr.status).json({
            code: serviceErr.code,
            message: serviceErr.message,
          });
        }
        throw serviceErr;
      }
    } else {
      // Reject the request
      advisorRequest.status = 'rejected';
      await group.save();

      // Create audit log for rejection
      try {
        await createAuditLog({
          action: 'advisor_request_rejected',
          actorId: professorId,
          groupId: group.groupId,
          payload: {
            requestId,
            reason: reason || null,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditErr) {
        console.error('Audit log failed (non-fatal):', auditErr.message);
      }

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
    console.error('advisorApproveRequest error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while processing the advisor decision',
    });
  }
};

/**
 * DELETE /api/v1/groups/:groupId/advisor
 *
 * Release an assigned advisor from a group.
 * Only Team Leader (group leader) or the assigned Advisor can release.
 * Clears advisorId and sets advisorStatus to released.
 * Updates Group record in D2 (Process 3.5).
 *
 * @param {string} req.params.groupId - Group ID
 * @param {string} req.body.reason - optional reason for release
 * @returns {200} { groupId, professorId, status, updatedAt }
 */
const releaseAdvisorHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { reason } = req.body;
    const releasedBy = req.user.userId;

    // Fetch group
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Authorization: only group leader or current advisor can release
    if (group.leaderId !== releasedBy && group.advisorId !== releasedBy) {
      return res.status(403).json({
        code: 'UNAUTHORIZED_RELEASE',
        message: 'Only the group leader or current advisor can release the advisor',
      });
    }

    // Process 3.5: Release advisor
    try {
      // eslint-disable-next-line no-await-in-loop
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const releaseResult = await releaseAdvisor(groupId, releasedBy, reason || null, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(200).json(releaseResult);
    } catch (serviceErr) {
      if (serviceErr instanceof AdvisorServiceError) {
        return res.status(serviceErr.status).json({
          code: serviceErr.code,
          message: serviceErr.message,
        });
      }
      throw serviceErr;
    }
  } catch (error) {
    console.error('releaseAdvisorHandler error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while releasing the advisor',
    });
  }
};

/**
 * POST /api/v1/groups/:groupId/advisor/transfer
 *
 * Coordinator transfers a group from its current advisor to a new professor.
 * Only Coordinator role can perform this action (403 for others).
 * Validates new professor exists and is not already assigned to another group.
 * Updates Group record in D2 with new advisorId and status: transferred (Process 3.5).
 *
 * @param {string} req.params.groupId - Group ID
 * @param {string} req.body.newProfessorId - New professor to assign
 * @param {string} req.body.reason - optional reason for transfer
 * @returns {200} { groupId, professorId, status, updatedAt }
 */
const transferAdvisorHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { newProfessorId, reason } = req.body;
    const coordinatorId = req.user.userId;

    // Input validation
    if (!newProfessorId || typeof newProfessorId !== 'string') {
      return res.status(400).json({
        code: 'MISSING_NEW_PROFESSOR_ID',
        message: 'newProfessorId is required',
      });
    }

    // Fetch group
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Process 3.5: Transfer advisor
    try {
      // eslint-disable-next-line no-await-in-loop
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const transferResult = await transferAdvisor(
        groupId,
        newProfessorId,
        coordinatorId,
        reason || null,
        {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );

      return res.status(200).json(transferResult);
    } catch (serviceErr) {
      if (serviceErr instanceof AdvisorServiceError) {
        return res.status(serviceErr.status).json({
          code: serviceErr.code,
          message: serviceErr.message,
        });
      }
      throw serviceErr;
    }
  } catch (error) {
    console.error('transferAdvisorHandler error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while transferring the advisor',
    });
  }
};

module.exports = {
  advisorApproveRequest,
  releaseAdvisorHandler,
  transferAdvisorHandler,
};
