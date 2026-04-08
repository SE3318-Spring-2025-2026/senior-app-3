const AdvisorRequest = require('../models/AdvisorRequest');
const Group = require('../models/Group');
const { createAuditLog } = require('../services/auditService');

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
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;

    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'decision must be "approve" or "reject"',
      });
    }

    const advisorRequest = await AdvisorRequest.findOne({ requestId });
    if (!advisorRequest) {
      return res.status(404).json({
        code: 'REQUEST_NOT_FOUND',
        message: 'Advisor request not found',
      });
    }

    if (advisorRequest.professorId !== req.user.userId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the professor named in this request can decide it',
      });
    }

    if (advisorRequest.status !== 'pending') {
      return res.status(409).json({
        code: 'REQUEST_ALREADY_PROCESSED',
        message: `Request has already been processed as ${advisorRequest.status}`,
        currentStatus: advisorRequest.status,
      });
    }

    const group = await Group.findOne({ groupId: advisorRequest.groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const now = new Date();
    let assignedGroupId = null;

    if (decision === 'approve') {
      group.advisorId = advisorRequest.professorId;
      await group.save();
      advisorRequest.status = 'approved';
      assignedGroupId = advisorRequest.groupId;
    } else {
      advisorRequest.status = 'rejected';
    }

    advisorRequest.reason = typeof reason === 'string' ? reason.trim() : '';
    advisorRequest.processedAt = now;
    await advisorRequest.save();

    try {
      await createAuditLog({
        action: decision === 'approve' ? 'advisor_approved' : 'advisor_rejected',
        actorId: req.user.userId,
        targetId: advisorRequest.requestId,
        groupId: advisorRequest.groupId,
        payload: {
          request_id: advisorRequest.requestId,
          decision,
          approval_status: advisorRequest.status,
          reason: advisorRequest.reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('advisor decision audit log failed (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      requestId: advisorRequest.requestId,
      decision,
      approvalStatus: advisorRequest.status === 'approved' ? 'approved' : 'rejected',
      assignedGroupId,
      professorId: advisorRequest.professorId,
      processedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('decideAdvisorRequest error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = {
  listProfessorPendingRequests,
  decideAdvisorRequest,
};
