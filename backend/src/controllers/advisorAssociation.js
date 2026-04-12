'use strict';

const Group = require('../models/Group');
const User = require('../models/User');
const AdvisorRequest = require('../models/AdvisorRequest');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('../services/auditService');
const notificationService = require('../services/notificationService');
const OT = require('../utils/operationTypes');

const isActiveSanitizationWindow = async () => {
  const now = new Date();
  return ScheduleWindow.findOne({
    operationType: OT.ADVISOR_SANITIZATION,
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  });
};

const hasFutureSanitizationWindow = async () => {
  const now = new Date();
  return ScheduleWindow.findOne({
    operationType: OT.ADVISOR_SANITIZATION,
    isActive: true,
    startsAt: { $gt: now },
  });
};

/**
 * GET /api/v1/advisor-requests/mine
 * All advisor requests for the authenticated professor (inbox), with group context.
 */
const listProfessorAdvisorRequests = async (req, res) => {
  try {
    const professorId = req.user.userId;
    const requests = await AdvisorRequest.find({ professorId }).sort({ createdAt: -1 });

    const groupIds = [...new Set(requests.map((r) => r.groupId))];
    const groups = await Group.find({ groupId: { $in: groupIds } });
    const groupMap = new Map(groups.map((g) => [g.groupId, g]));

    const leadersMap = new Map();
    for (const group of groups) {
      const leader = await User.findOne({ userId: group.leaderId }).select('email');
      if (leader) {
        leadersMap.set(group.leaderId, leader.email);
      }
    }

    const enriched = requests.map((doc) => {
      const plain = doc.toObject();
      const g = groupMap.get(doc.groupId);
      return {
        ...plain,
        groupName: g?.groupName || 'Unknown Group',
        leaderEmail: leadersMap.get(g?.leaderId) || 'Unknown',
        decision:
          plain.status === 'approved'
            ? 'approve'
            : plain.status === 'rejected'
              ? 'reject'
              : null,
      };
    });

    return res.status(200).json({ requests: enriched });
  } catch (err) {
    console.error('listProfessorAdvisorRequests error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to retrieve requests.',
    });
  }
};

/**
 * GET /api/v1/advisor-requests/pending
 * Pending requests only (compact payload for dashboards).
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
 * POST /api/v1/advisor-requests
 */
const submitAdvisorRequest = async (req, res) => {
  try {
    const { groupId, professorId } = req.body;
    if (!groupId || !professorId) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'groupId and professorId are required',
      });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== req.user.userId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the team leader can submit advisor requests',
      });
    }

    const professor = await User.findOne({ userId: professorId, role: 'professor' });
    if (!professor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Professor not found' });
    }

    if (group.advisorStatus === 'assigned' && group.professorId) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Group already has an advisor' });
    }

    const pending = await AdvisorRequest.findOne({ groupId, status: 'pending' });
    if (pending) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Pending advisor request already exists' });
    }

    const requestDoc = await AdvisorRequest.create({
      groupId,
      professorId,
      requesterId: req.user.userId,
    });

    await Group.updateOne({ groupId }, { $set: { advisorStatus: 'pending' } });

    try {
      await notificationService.dispatchAdvisorRequestNotification({ groupId, professorId });
    } catch (notifyErr) {
      console.error('dispatchAdvisorRequestNotification:', notifyErr.message);
    }

    await createAuditLog({
      action: 'advisor_request_submitted',
      actorId: req.user.userId,
      targetId: requestDoc.requestId,
      groupId,
      payload: {
        requestId: requestDoc.requestId,
        groupId,
        professorId,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.status(201).json({
      requestId: requestDoc.requestId,
      notificationTriggered: true,
    });
  } catch (err) {
    console.error('submitAdvisorRequest error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * PATCH /api/v1/advisor-requests/:requestId
 */
const processAdvisorRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;

    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: "decision must be 'approve' or 'reject'",
      });
    }

    const ar = await AdvisorRequest.findOne({ requestId });
    if (!ar) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Advisor request not found' });
    }

    if (ar.professorId !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This request is assigned to another professor',
      });
    }

    if (ar.status !== 'pending') {
      return res.status(409).json({ code: 'CONFLICT', message: 'Request already processed' });
    }

    const group = await Group.findOne({ groupId: ar.groupId });
    if (!group) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Group not found' });
    }

    const now = new Date();
    const reasonText =
      typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';

    if (decision === 'approve') {
      if (group.advisorId && group.advisorId !== ar.professorId) {
        return res.status(409).json({
          code: 'GROUP_ALREADY_HAS_ADVISOR',
          message: 'Group already has an assigned advisor',
        });
      }

      ar.status = 'approved';
      ar.reason = reasonText || null;
      ar.processedAt = now;
      await ar.save();

      group.professorId = ar.professorId;
      group.advisorId = ar.professorId;
      group.advisorStatus = 'assigned';
      await group.save();

      try {
        await notificationService.dispatchAdvisorDecisionNotification({
          groupId: ar.groupId,
          professorId: ar.professorId,
          decision: 'approve',
          requestId: ar.requestId,
        });
      } catch (notifyErr) {
        console.error('dispatchAdvisorDecisionNotification:', notifyErr.message);
      }

      await createAuditLog({
        action: 'advisor_approved',
        actorId: req.user.userId,
        targetId: ar.requestId,
        groupId: ar.groupId,
        payload: {
          requestId: ar.requestId,
          groupId: ar.groupId,
          decision: 'approve',
          professorId: ar.professorId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return res.status(200).json({
        requestId: ar.requestId,
        decision: 'approve',
        approvalStatus: ar.status,
        assignedGroupId: ar.groupId,
        advisorStatus: 'assigned',
        professorId: ar.professorId,
      });
    }

    ar.status = 'rejected';
    ar.reason = reasonText || null;
    ar.processedAt = now;
    await ar.save();

    try {
      await notificationService.dispatchAdvisorDecisionNotification({
        groupId: ar.groupId,
        professorId: ar.professorId,
        decision: 'reject',
        requestId: ar.requestId,
      });
    } catch (notifyErr) {
      console.error('dispatchAdvisorDecisionNotification:', notifyErr.message);
    }

    await createAuditLog({
      action: 'advisor_rejected',
      actorId: req.user.userId,
      targetId: ar.requestId,
      groupId: ar.groupId,
      payload: {
        requestId: ar.requestId,
        groupId: ar.groupId,
        decision: 'reject',
        professorId: ar.professorId,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.status(200).json({
      requestId: ar.requestId,
      decision: 'reject',
      approvalStatus: ar.status,
      assignedGroupId: null,
    });
  } catch (err) {
    console.error('processAdvisorRequest error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * DELETE /api/v1/groups/:groupId/advisor
 */
const releaseAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Group not found' });
    }

    const isLeader = group.leaderId === req.user.userId;
    const isCoordinator = req.user.role === 'coordinator';
    if (!isLeader && !isCoordinator) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the group leader or a coordinator can release the advisor',
      });
    }

    if (group.advisorStatus !== 'assigned' || !group.professorId) {
      return res.status(409).json({ code: 'CONFLICT', message: 'No advisor is currently assigned' });
    }

    group.professorId = null;
    group.advisorId = null;
    group.advisorStatus = 'released';
    await group.save();

    await createAuditLog({
      action: 'advisor_released',
      actorId: req.user.userId,
      targetId: groupId,
      groupId,
      payload: { groupId, previousAdvisorReleased: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('releaseAdvisor error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * POST /api/v1/groups/:groupId/advisor/transfer
 */
const transferAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { targetProfessorId } = req.body;
    if (!targetProfessorId) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'targetProfessorId is required',
      });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Group not found' });
    }

    if (group.advisorStatus !== 'assigned' || !group.professorId) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Group has no assigned advisor to transfer' });
    }

    const target = await User.findOne({ userId: targetProfessorId, role: 'professor' });
    if (!target) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Target professor not found' });
    }

    const conflict = await Group.findOne({
      groupId: { $ne: groupId },
      professorId: targetProfessorId,
      advisorStatus: 'assigned',
    });
    if (conflict) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'Target professor already advises another group',
      });
    }

    const oldProfessorId = group.professorId;
    group.professorId = targetProfessorId;
    group.advisorId = targetProfessorId;
    group.advisorStatus = 'transferred';
    await group.save();

    await notificationService.dispatchAdvisorTransferNotification({
      groupId,
      oldProfessorId,
      newProfessorId: targetProfessorId,
    });

    await createAuditLog({
      action: 'advisor_transferred',
      actorId: req.user.userId,
      targetId: groupId,
      groupId,
      payload: {
        groupId,
        oldProfessorId,
        newProfessorId: targetProfessorId,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('transferAdvisor error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * POST /api/v1/groups/advisor-sanitization
 */
const advisorSanitization = async (req, res) => {
  try {
    const active = await isActiveSanitizationWindow();
    const future = await hasFutureSanitizationWindow();

    if (!active && future) {
      return res.status(409).json({
        code: 'SANITIZATION_BEFORE_WINDOW',
        message: 'Advisor sanitization is not available before the scheduled window',
      });
    }

    if (!active) {
      return res.status(422).json({
        code: 'OUTSIDE_SCHEDULE_WINDOW',
        message: 'Operation not available outside the configured schedule window',
      });
    }

    const candidates = await Group.find({
      advisorStatus: { $in: ['released', 'pending'] },
      professorId: null,
    }).lean();

    const disbandedGroups = [];
    for (const g of candidates) {
      disbandedGroups.push(g.groupId);
      await notificationService.dispatchGroupDisbandNotification({ groupId: g.groupId });
      await createAuditLog({
        action: 'group_disbanded',
        actorId: req.user.userId,
        targetId: g.groupId,
        groupId: g.groupId,
        payload: { groupId: g.groupId, reason: 'advisor_sanitization' },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      await Group.updateOne(
        { groupId: g.groupId },
        { $set: { status: 'inactive', advisorStatus: 'pending' } }
      );
    }

    return res.status(200).json({ disbandedGroups });
  } catch (err) {
    console.error('advisorSanitization error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

module.exports = {
  listProfessorAdvisorRequests,
  listProfessorPendingRequests,
  submitAdvisorRequest,
  processAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  advisorSanitization,
};
