const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const advisorRequestService = require('../services/advisorRequestService');
const ScheduleWindow = require('../models/ScheduleWindow');
const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const { createAuditLog } = require('../services/auditService');

/**
 * Process 3.1: Submit Advisee Request
 * Logic:
 * - Enforce schedule window boundary (422)
 * - Authorize requester: must be the Team Leader of the specified group (403)
 */
const createRequest = async (req, res) => {
  try {
    const { groupId, professorId, message } = req.body;
    const requesterId = req.user.userId;

    // 1. Input validation
    if (!groupId?.trim() || !professorId?.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'groupId and professorId must be non-empty strings.',
      });
    }

    // 2. Schedule boundary enforcement
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      startsAt: { $lte: now },
      endsAt: { $gte: now }
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'WINDOW_CLOSED',
        message: 'The advisor association window is currently closed.'
      });
    }

    // 3. Authorization (Team Leader Guard)
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found.' });
    }

    if (group.leaderId !== requesterId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the Team Leader can submit an advisor request.'
      });
    }

    // 4. Forward to Service
    const result = await advisorRequestService.submitRequest({
      groupId,
      professorId,
      requesterId,
      message
    });

    return res.status(201).json({
      status: 'created',
      requestId: result.requestId,
      message: 'Advisor request submitted successfully.'
    });

  } catch (error) {
    console.error('Advisor request error:', error);
    const status = error.status || 500;
    return res.status(status).json({
      code: error.code || 'SERVER_ERROR',
      message: error.message
    });
  }
};

/**
 * Process 3.5: Release Advisor
 * Logic:
 * - Transactional update of Group and AdvisorAssignment history
 * - Enforce schedule window boundary (422)
 */
const releaseAdvisor = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { groupId } = req.params;
    const { professorId, reason } = req.body || {};
    const requesterId = req.user.userId;
    const requesterRole = req.user.role;

    // 1. Schedule boundary enforcement (Feature Branch logic)
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      startsAt: { $lte: now },
      endsAt: { $gte: now }
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'WINDOW_CLOSED',
        message: 'The advisor association window is closed. Release blocked.'
      });
    }

    let responsePayload;

    await session.withTransaction(async () => {
      // 2. Fetch group
      const group = await Group.findOne({ groupId }).session(session);
      if (!group) {
        throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };
      }

      // 3. Authorization
      const isTeamLeader = group.leaderId === requesterId;
      const isCoordinator = requesterRole === 'coordinator';

      if (!isTeamLeader && !isCoordinator) {
        throw { status: 403, code: 'FORBIDDEN', message: 'Unauthorized to release advisor.' };
      }

      // 4. Conflict Check
      if (!group.advisorId) {
        throw { status: 409, code: 'NO_ASSIGNED_ADVISOR', message: 'No advisor assigned.' };
      }

      if (professorId && group.advisorId !== professorId) {
        throw { status: 400, code: 'ADVISOR_MISMATCH', message: 'Advisor mismatch.' };
      }

      const oldAdvisorId = group.advisorId;

      // 5. Update Group and History (Main Branch logic)
      group.advisorId = null;
      group.advisorStatus = 'released';
      await group.save({ session });

      await AdvisorAssignment.create([{
        assignmentId: `asn_${uuidv4().split('-')[0]}`,
        groupId: group.groupId,
        groupRef: group._id,
        advisorId: oldAdvisorId,
        status: 'released',
        releasedBy: requesterId,
        releaseReason: reason || 'No reason provided',
        releasedAt: new Date()
      }], { session });

      // 6. Audit Log
      try {
        await createAuditLog({
          action: 'ADVISOR_RELEASED',
          actorId: requesterId,
          groupId: group.groupId,
          targetId: oldAdvisorId,
          payload: { reason: reason || 'No reason provided' },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }, session);
      } catch (e) { console.error('Audit failed:', e.message); }

      responsePayload = {
        groupId: group.groupId,
        professorId: null,
        status: 'released',
        updatedAt: group.updatedAt
      };
    });

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('releaseAdvisor error:', error);
    const status = error.status || 500;
    return res.status(status).json({
      code: error.code || 'SERVER_ERROR',
      message: error.message
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  createRequest,
  releaseAdvisor,
};