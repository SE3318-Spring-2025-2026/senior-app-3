const Group = require('../models/Group');
const { approveAdvisorRequest, releaseAdvisor, transferAdvisor, AdvisorServiceError } = require('../services/advisorService');
const { dispatchAdvisorRequestNotification } = require('../services/notificationService');
const { createAuditLog } = require('../services/auditService');

/**
 * Helper: Validate advisor decision input
 */
function validateAdvisorDecisionInputs(body) {
  const { decision, reason } = body;

  if (!decision || !['approve', 'reject'].includes(decision)) {
    const err = new Error('Decision must be "approve" or "reject"');
    err.status = 400;
    err.code = 'INVALID_DECISION';
    throw err;
  }

  return { decision, reason: reason || '' };
}

/**
 * Helper: Dispatch approval notification with retry logic
 */
async function dispatchApprovalNotification(group, professorId, requesterId) {
  const result = await dispatchAdvisorRequestNotification({
    groupId: group.groupId,
    groupName: group.groupName,
    professorId: requesterId,
    requesterId: professorId,
    message: 'Your advisee request has been approved',
  });

  return result.success;
}

/**
 * advisorApproveRequest(req, res)
 *
 * PATCH /advisor-requests/:requestId
 * Process 3.4 (Advisor Decision) → 3.5 (Assignment)
 *
 * Professor approves or rejects an advisee request.
 * On approval: group is assigned to advisor, audit log + AdvisorAssignment record created.
 * On rejection: request status updated, no assignment made.
 *
 * Authorization: Only the professor named in the request can respond (403 otherwise).
 * Schedule: Subject to advisor_association window enforcement (422 if outside).
 */
async function advisorApproveRequest(req, res) {
  try {
    const { requestId } = req.params;
    const { decision, reason } = validateAdvisorDecisionInputs(req.body);
    const professorId = req.user?.id;

    if (!professorId) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    // Find group with matching request
    const group = await Group.findOne({ 'advisorRequest.requestId': requestId });
    if (!group) {
      return res.status(404).json({ code: 'REQUEST_NOT_FOUND', message: 'Advisor request not found' });
    }

    // Verify professor is the recipient of the request
    if (group.advisorRequest.professorId !== professorId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the requested professor can respond to this request',
      });
    }

    // Verify request is still pending
    if (group.advisorRequest.status !== 'pending') {
      return res.status(409).json({
        code: 'REQUEST_ALREADY_PROCESSED',
        message: `Request has already been ${group.advisorRequest.status}`,
      });
    }

    let result;

    if (decision === 'approve') {
      // Process 3.5: Approve
      try {
        result = await approveAdvisorRequest(group.groupId, requestId, professorId, professorId);
      } catch (err) {
        if (err instanceof AdvisorServiceError) {
          return res.status(err.status).json({ code: err.code, message: err.message });
        }
        throw err;
      }

      // Dispatch approval notification to group leader (non-fatal)
      const notificationTriggered = await dispatchApprovalNotification(
        group,
        professorId,
        group.advisorRequest.requestedBy
      );

      return res.status(200).json({
        requestId,
        groupId: group.groupId,
        decision: 'approve',
        status: 'assigned',
        professorId,
        notificationTriggered,
        assignedAt: result.updatedAt,
      });
    } else {
      // Reject
      group.advisorRequest.status = 'rejected';
      await group.save();

      // Create audit log
      await createAuditLog({
        action: 'advisor_request_rejected',
        userId: professorId,
        resourceType: 'advisor_request',
        resourceId: requestId,
        changeDetails: {
          groupId: group.groupId,
          reason,
        },
      });

      return res.status(200).json({
        requestId,
        groupId: group.groupId,
        decision: 'reject',
        status: 'rejected',
        rejectedAt: new Date(),
      });
    }
  } catch (err) {
    console.error('[advisorApproveRequest]', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
}

/**
 * releaseAdvisorHandler(req, res)
 *
 * DELETE /groups/:groupId/advisor
 * Process 3.5 (Release Path)
 *
 * Team Leader or Advisor releases the current advisor from the group.
 * Group becomes available for new advisor request.
 *
 * Authorization: Team Leader or current Advisor only (403 otherwise).
 * Schedule: Subject to advisor_association window enforcement (422 if outside).
 */
async function releaseAdvisorHandler(req, res) {
  try {
    const { groupId } = req.params;
    const { reason } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    // Authorization: Team Leader or current Advisor
    const isTeamLeader = group.leaderId === userId;
    const isCurrentAdvisor = group.advisorId === userId;

    if (!isTeamLeader && !isCurrentAdvisor) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the Team Leader or current Advisor can release the advisor',
      });
    }

    // Release advisor
    try {
      const result = await releaseAdvisor(groupId, userId, reason || '');
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof AdvisorServiceError) {
        return res.status(err.status).json({ code: err.code, message: err.message });
      }
      throw err;
    }
  } catch (err) {
    console.error('[releaseAdvisorHandler]', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
}

/**
 * transferAdvisorHandler(req, res)
 *
 * POST /groups/:groupId/advisor/transfer
 * Process 3.6 (Coordinator Transfer) → 3.5 (Assignment)
 *
 * Coordinator transfers group from current advisor to new professor.
 * Bypasses standard advisee request flow.
 *
 * Authorization: Coordinator only (403 otherwise).
 * Schedule: Subject to advisor_association window enforcement (422 if outside).
 */
async function transferAdvisorHandler(req, res) {
  try {
    const { groupId } = req.params;
    const { newProfessorId, reason } = req.body;
    const coordinatorId = req.user?.id;

    if (!coordinatorId) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    // Verify role is coordinator
    if (req.user?.role !== 'coordinator' && req.user?.role !== 'admin') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only coordinators can transfer advisors',
      });
    }

    if (!newProfessorId) {
      return res.status(400).json({
        code: 'MISSING_FIELD',
        message: 'newProfessorId is required',
      });
    }

    // Transfer advisor
    try {
      const result = await transferAdvisor(groupId, newProfessorId, coordinatorId, reason || '');
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof AdvisorServiceError) {
        return res.status(err.status).json({ code: err.code, message: err.message });
      }
      throw err;
    }
  } catch (err) {
    console.error('[transferAdvisorHandler]', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
}

module.exports = {
  advisorApproveRequest,
  releaseAdvisorHandler,
  transferAdvisorHandler,
};
