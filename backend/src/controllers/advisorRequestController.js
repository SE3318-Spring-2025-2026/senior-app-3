const advisorRequestService = require('../services/advisorRequestService');
const ScheduleWindow = require('../models/ScheduleWindow');
const Group = require('../models/Group');
const { createAuditLog } = require('../services/auditService');

/**
 * Process 3.1: Submit Advisee Request
 * 
 * Logic:
 * - Enforce schedule window boundary (422)
 * - Authorize requester: must be the Team Leader of the specified group (403)
 * - Forward valid data to Process 3.2 (Service)
 */
const createRequest = async (req, res) => {
  try {
    const { groupId, professorId, message } = req.body;
    const requesterId = req.user.userId;

    // 1. Input validation
    if (!groupId || !professorId) {
      return res.status(400).json({
        code: 'MISSING_FIELDS',
        message: 'groupId and professorId are required.'
      });
    }

    // 2. Schedule boundary enforcement (Coordinator set window)
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      startsAt: { $lte: now },
      endsAt: { $gte: now }
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'WINDOW_CLOSED',
        message: 'The advisor association window is currently closed. Please check the coordinator schedule.'
      });
    }

    // 3. Authorization (Team Leader Guard)
    const group = await Group.findOne({ groupId });
    if (!group) {
        return res.status(404).json({
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found.'
        });
    }

    if (group.leaderId !== requesterId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the Team Leader of the group can submit an advisor request.'
      });
    }

    // 4. Forward to Process 3.2
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
    
    if (error.status) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while processing the request.'
    });
  }
};

/**
 * Process 3.5: Release Advisor
 * 
 * Logic:
 * - Authorize requester: Team Leader or Coordinator (403)
 * - Enforce schedule window boundary (422)
 * - Verify group currently has an assigned advisor (409)
 * - Update D2 group record: clear advisorId, set advisorStatus to 'released'
 * - Log the action to audit trail
 */
const releaseAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { professorId, reason } = req.body;
    const requesterId = req.user.userId;
    const requesterRole = req.user.role;

    // 1. Fetch group and check if it exists
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found.'
      });
    }

    // 2. Authorization (Team Leader or Coordinator)
    const isTeamLeader = group.leaderId === requesterId;
    const isCoordinator = requesterRole === 'coordinator';

    if (!isTeamLeader && !isCoordinator) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the Team Leader or a Coordinator can release the advisor.'
      });
    }

    // 3. Schedule boundary enforcement
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      startsAt: { $lte: now },
      endsAt: { $gte: now }
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'WINDOW_CLOSED',
        message: 'The advisor association window is currently closed. Advisor release is blocked.'
      });
    }

    // 4. Conflict Check: check if group HAS an advisor
    if (!group.advisorId) {
      return res.status(409).json({
        code: 'NO_ASSIGNED_ADVISOR',
        message: 'Group does not currently have an assigned advisor.'
      });
    }

    // Optional: Validation of professorId if provided
    if (professorId && group.advisorId !== professorId) {
      return res.status(400).json({
        code: 'ADVISOR_MISMATCH',
        message: 'The provided professorId does not match the currently assigned advisor.'
      });
    }

    const oldAdvisorId = group.advisorId;

    // 5. Update D2 Record (Process 3.5 → D2)
    group.advisorId = null;
    group.advisorStatus = 'released';
    await group.save();

    // 6. Audit Log
    try {
      await createAuditLog({
        action: 'ADVISOR_RELEASED',
        actorId: requesterId,
        groupId: group.groupId,
        targetId: oldAdvisorId,
        payload: {
          previous_advisor: oldAdvisorId,
          reason: reason || 'No reason provided',
          requester_role: requesterRole
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Advisor release audit log failed:', auditError.message);
    }

    // 7. Response (OpenAPI AdvisorAssignment schema)
    return res.status(200).json({
      groupId: group.groupId,
      professorId: null,
      status: 'released',
      updatedAt: group.updatedAt
    });

  } catch (error) {
    console.error('Release advisor error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while releasing the advisor.'
    });
  }
};

module.exports = {
  createRequest,
  releaseAdvisor
};

