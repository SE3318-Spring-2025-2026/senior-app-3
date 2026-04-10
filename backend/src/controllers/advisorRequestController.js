const advisorRequestService = require('../services/advisorRequestService');
const ScheduleWindow = require('../models/ScheduleWindow');
const Group = require('../models/Group');

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
    if (
      typeof groupId !== 'string' || !groupId.trim() ||
      typeof professorId !== 'string' || !professorId.trim()
    ) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'groupId and professorId must be non-empty strings.',
      });
    }

    // 2. Schedule boundary enforcement (Coordinator set window)
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      isActive: true,
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

module.exports = {
  createRequest
};
