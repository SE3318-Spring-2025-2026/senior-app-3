'use strict';

const Group = require('../models/Group');
const User = require('../models/User');
const AdvisorRequest = require('../models/AdvisorRequest');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('../services/auditService');
const notificationService = require('../services/notificationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
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
 * GET /api/v1/advisor-requests/coordinator/pending
 * All pending advisor requests (coordinator / admin oversight).
 */
const listCoordinatorPendingAdvisorRequests = async (req, res) => {
  try {
    const requests = await AdvisorRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
    const groupIds = [...new Set(requests.map((r) => r.groupId))];
    const groups = await Group.find({ groupId: { $in: groupIds } })
      .select('groupId groupName leaderId')
      .lean();
    const groupMap = new Map(groups.map((g) => [g.groupId, g]));

    // Collect every userId we need to resolve in a single round-trip:
    // professors named in the request + the leader and the requester for each group.
    const userIds = new Set();
    requests.forEach((r) => {
      if (r.professorId) userIds.add(r.professorId);
      if (r.requesterId) userIds.add(r.requesterId);
    });
    groups.forEach((g) => {
      if (g.leaderId) userIds.add(g.leaderId);
    });

    const users = await User.find({ userId: { $in: [...userIds] } })
      .select('userId email name')
      .lean();
    const userMap = new Map(users.map((u) => [u.userId, u]));

    const enriched = requests.map((r) => {
      const group = groupMap.get(r.groupId);
      const professor = userMap.get(r.professorId);
      const leader = group?.leaderId ? userMap.get(group.leaderId) : null;
      const requester = userMap.get(r.requesterId);
      return {
        requestId: r.requestId,
        groupId: r.groupId,
        groupName: group?.groupName || null,
        leaderId: group?.leaderId || null,
        leaderName: leader?.name || null,
        leaderEmail: leader?.email || null,
        professorId: r.professorId,
        professorName: professor?.name || null,
        professorEmail: professor?.email || null,
        requesterId: r.requesterId,
        requesterName: requester?.name || null,
        requesterEmail: requester?.email || null,
        status: r.status,
        message: r.message || '',
        createdAt: r.createdAt,
      };
    });

    return res.status(200).json({ requests: enriched, total: enriched.length });
  } catch (err) {
    console.error('listCoordinatorPendingAdvisorRequests error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to retrieve pending advisor requests.',
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

    const pending = await AdvisorRequest.findOne({ groupId, status: 'pending' });

    if (group.advisorStatus === 'assigned' && group.professorId) {
      let assignedProfessor = null;
      try {
        assignedProfessor = await User.findOne({ userId: group.professorId })
          .select('userId email name')
          .lean();
      } catch (_) { /* non-fatal */ }
      return res.status(409).json({
        code: 'GROUP_ALREADY_HAS_ADVISOR',
        message: assignedProfessor
          ? `Group already has an advisor (${assignedProfessor.name || assignedProfessor.email}).`
          : 'Group already has an advisor',
        assignedProfessorId: group.professorId,
        assignedProfessorEmail: assignedProfessor?.email || null,
        assignedProfessorName: assignedProfessor?.name || null,
      });
    }

    if (pending) {
      let pendingProfessor = null;
      try {
        pendingProfessor = await User.findOne({ userId: pending.professorId })
          .select('userId email name')
          .lean();
      } catch (_) { /* non-fatal */ }
      const profLabel = pendingProfessor?.name || pendingProfessor?.email || pending.professorId;
      return res.status(409).json({
        code: 'ADVISOR_REQUEST_PENDING',
        message: `A pending advisor request already exists for this group (sent to ${profLabel}). Cancel it or wait for the professor's decision before submitting another.`,
        pendingRequestId: pending.requestId,
        pendingProfessorId: pending.professorId,
        pendingProfessorEmail: pendingProfessor?.email || null,
        pendingProfessorName: pendingProfessor?.name || null,
        pendingCreatedAt: pending.createdAt || null,
      });
    }

    const requestDoc = await AdvisorRequest.create({
      groupId,
      professorId,
      requesterId: req.user.userId,
    });

    await Group.updateOne({ groupId }, { $set: { advisorStatus: 'pending' } });

    const notifyResult = await retryNotificationWithBackoff(
      () =>
        notificationService.dispatchAdvisorRequestNotification({
          type: 'advisee_request',
          groupId,
          professorId,
          teamLeaderId: req.user.userId,
        }),
      {
        maxAttempts: 3,
        identifier: requestDoc.requestId,
        identifierType: 'requestId',
      }
    );
    const notificationTriggered = notifyResult.success;

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
      notificationTriggered,
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

    const elevated = req.user.role === 'coordinator' || req.user.role === 'admin';
    if (!elevated && ar.professorId !== req.user.userId) {
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

      const notifyResultApprove = await retryNotificationWithBackoff(
        () =>
          notificationService.dispatchAdvisorDecisionNotification({
            type: 'approval_notice',
            groupId: ar.groupId,
            requestId: ar.requestId,
            professorId: ar.professorId,
            teamLeaderId: group.leaderId,
            decision: 'approve',
          }),
        {
          maxAttempts: 3,
          identifier: ar.requestId,
          identifierType: 'requestId',
        }
      );
      const notificationTriggeredApprove = notifyResultApprove.success;

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
        notificationTriggered: notificationTriggeredApprove,
      });
    }

    ar.status = 'rejected';
    ar.reason = reasonText || null;
    ar.processedAt = now;
    await ar.save();

    const notifyResultReject = await retryNotificationWithBackoff(
      () =>
        notificationService.dispatchAdvisorDecisionNotification({
          type: 'rejection_notice',
          groupId: ar.groupId,
          requestId: ar.requestId,
          professorId: ar.professorId,
          teamLeaderId: group.leaderId,
          decision: 'reject',
          reason: reasonText || undefined,
        }),
      {
        maxAttempts: 3,
        identifier: ar.requestId,
        identifierType: 'requestId',
      }
    );
    const notificationTriggeredReject = notifyResultReject.success;

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
      notificationTriggered: notificationTriggeredReject,
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
    const now = new Date();
    const active = await isActiveSanitizationWindow();
    const future = await hasFutureSanitizationWindow();
    const latestAdvisorAssociationWindow = await ScheduleWindow.findOne({
      operationType: OT.ADVISOR_ASSOCIATION,
      isActive: true,
    })
      .sort({ endsAt: -1 })
      .lean();

    if (!active && latestAdvisorAssociationWindow && now < latestAdvisorAssociationWindow.endsAt) {
      return res.status(409).json({
        code: 'DEADLINE_NOT_REACHED',
        message: `Advisor association window is still active. Deadline: ${latestAdvisorAssociationWindow.endsAt.toISOString()}`,
      });
    }

    if (!active && future) {
      return res.status(409).json({
        code: 'SANITIZATION_BEFORE_WINDOW',
        message: 'Advisor sanitization is not available before the scheduled window',
      });
    }

    if (!active && !latestAdvisorAssociationWindow) {
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
    const notificationFailures = [];
    for (const g of candidates) {
      disbandedGroups.push(g.groupId);

      const acceptedMembers = (g.members || [])
        .filter((m) => m && m.status === 'accepted' && m.userId)
        .map((m) => m.userId);
      const members = acceptedMembers.length > 0
        ? acceptedMembers
        : (g.leaderId ? [g.leaderId] : []);

      // Keep backward-compatible side effect expected by existing tests and integrations.
      await notificationService.dispatchGroupDisbandNotification({
        groupId: g.groupId,
        reason: 'advisor_sanitization',
      }).catch(() => {});

      const notifyResult = await retryNotificationWithBackoff(
        () =>
          notificationService.dispatchDisbandNotification({
            type: 'disband_notice',
            groupId: g.groupId,
            groupName: g.groupName,
            members,
            reason: 'advisor_sanitization',
          }),
        {
          maxAttempts: 3,
          identifier: g.groupId,
          identifierType: 'groupId',
        }
      );
      if (!notifyResult.success) {
        notificationFailures.push({
          groupId: g.groupId,
          error: notifyResult.error?.message || 'notification_dispatch_failed',
        });
      }

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

    return res.status(200).json({
      success: true,
      count: disbandedGroups.length,
      disbandedGroups,
      notificationFailures,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('advisorSanitization error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * DELETE /api/v1/advisor-requests/:requestId
 *
 * Lets the team leader (or coordinator/admin) cancel a pending advisor
 * request before the professor decides on it. Once cancelled the row stays
 * in the collection for audit trails but stops blocking new submissions
 * (the partial unique index only enforces "one pending row per group").
 */
const cancelAdvisorRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const ar = await AdvisorRequest.findOne({ requestId });
    if (!ar) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Advisor request not found' });
    }

    if (ar.status !== 'pending') {
      return res.status(409).json({
        code: 'NOT_PENDING',
        message: `Request is already ${ar.status} and cannot be cancelled.`,
      });
    }

    const elevated = req.user.role === 'coordinator' || req.user.role === 'admin';

    let isLeader = false;
    if (!elevated) {
      const group = await Group.findOne({ groupId: ar.groupId }).select('leaderId advisorStatus').lean();
      if (!group) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Group not found' });
      }
      isLeader = group.leaderId === req.user.userId;
      if (!isLeader && ar.requesterId !== req.user.userId) {
        return res.status(403).json({
          code: 'FORBIDDEN',
          message: 'Only the team leader (or coordinator) can cancel this request.',
        });
      }
    }

    ar.status = 'cancelled';
    ar.processedAt = new Date();
    await ar.save();

    // If the group still believes it has a "pending" advisor relationship and no
    // other pending request remains, demote it back to 'unassigned' so a new
    // submission isn't blocked further down the chain.
    try {
      const stillHasPending = await AdvisorRequest.findOne({
        groupId: ar.groupId,
        status: 'pending',
      }).select('requestId').lean();
      if (!stillHasPending) {
        await Group.updateOne(
          { groupId: ar.groupId, advisorStatus: 'pending' },
          { $set: { advisorStatus: null } }
        );
      }
    } catch (_) { /* non-fatal: group flag normalization */ }

    await createAuditLog({
      action: 'advisor_request_cancelled',
      actorId: req.user.userId,
      targetId: ar.requestId,
      groupId: ar.groupId,
      payload: {
        requestId: ar.requestId,
        groupId: ar.groupId,
        cancelledByRole: req.user.role,
        elevated,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});

    return res.status(200).json({
      requestId: ar.requestId,
      status: ar.status,
      groupId: ar.groupId,
      professorId: ar.professorId,
    });
  } catch (err) {
    console.error('cancelAdvisorRequest error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

module.exports = {
  listProfessorAdvisorRequests,
  listProfessorPendingRequests,
  listCoordinatorPendingAdvisorRequests,
  submitAdvisorRequest,
  processAdvisorRequest,
  cancelAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  advisorSanitization,
};
