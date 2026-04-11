const AdvisorRequest = require('../models/AdvisorRequest');
const Group = require('../models/Group');
const User = require('../models/User');
const ScheduleWindow = require('../models/ScheduleWindow');

const getMyRequests = async (req, res) => {
  try {
    const { userId, role } = req.user;

    if (!['professor', 'advisor'].includes(role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only professors can view advisor requests.',
      });
    }

    const requests = await AdvisorRequest.find({ professorId: userId })
      .sort({ createdAt: -1 });

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

    const enriched = requests.map((req) => ({
      ...req.toObject(),
      groupName: groupMap.get(req.groupId)?.groupName || 'Unknown Group',
      leaderEmail: leadersMap.get(groupMap.get(req.groupId)?.leaderId) || 'Unknown',
    }));

    return res.status(200).json({ requests: enriched });
  } catch (err) {
    console.error('getMyRequests error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to retrieve requests.',
    });
  }
};

const decideOnRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, reason } = req.body;
    const { userId, role } = req.user;

    if (!['professor', 'advisor'].includes(role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only professors can decide on advisor requests.',
      });
    }

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'Decision must be "approve" or "reject".',
      });
    }

    const advisorRequest = await AdvisorRequest.findOne({ requestId });
    if (!advisorRequest) {
      return res.status(404).json({
        code: 'REQUEST_NOT_FOUND',
        message: 'Advisor request not found.',
      });
    }

    if (advisorRequest.professorId !== userId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This request is not directed to you.',
      });
    }

    if (advisorRequest.status !== 'pending') {
      return res.status(409).json({
        code: 'ALREADY_PROCESSED',
        message: `Request has already been ${advisorRequest.status}.`,
        details: {
          requestId,
          currentStatus: advisorRequest.status,
          decision: advisorRequest.decision,
          processedAt: advisorRequest.processedAt,
        },
      });
    }

    const now = new Date();
    const scheduleWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      startsAt: { $lte: now },
      endsAt: { $gte: now },
      isActive: true,
    });

    if (!scheduleWindow) {
      return res.status(422).json({
        code: 'OUTSIDE_SCHEDULE_WINDOW',
        message: 'Advisor association window is currently closed.',
      });
    }

    advisorRequest.decision = decision;
    advisorRequest.reason = reason || null;
    advisorRequest.status = decision === 'approve' ? 'approved' : 'rejected';
    advisorRequest.decisionBy = userId;
    advisorRequest.processedAt = now;

    if (decision === 'approve') {
      const group = await Group.findOne({ groupId: advisorRequest.groupId });
      if (group) {
        group.advisorId = userId;
        await group.save();
      }
    }

    await advisorRequest.save();

    return res.status(200).json({
      requestId: advisorRequest.requestId,
      decision: advisorRequest.decision,
      status: advisorRequest.status,
      processorId: userId,
      processedAt: advisorRequest.processedAt,
    });
  } catch (err) {
    console.error('decideOnRequest error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to process decision.',
    });
  }
};

module.exports = {
  getMyRequests,
  decideOnRequest,
};
