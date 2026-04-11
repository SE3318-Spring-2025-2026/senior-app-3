const advisorRequestService = require('../services/advisorRequestService');
const Group = require('../models/Group');

/**
 * Process 3.1: Submit Advisee Request
 *
 * Logic:
 * - Schedule window is enforced by checkScheduleWindow('advisor_association') on the route
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

    // 2. Authorization (Team Leader Guard)
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found.',
      });
    }

    if (group.leaderId !== requesterId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the Team Leader of the group can submit an advisor request.',
      });
    }

    // 3. Forward to Process 3.2
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
 * POST /groups/:groupId/release-advisor — Team Leader releases current advisor
 */
const releaseAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const requesterId = req.user.userId;
    const { reason } = req.body || {};

    if (typeof groupId !== 'string' || !groupId.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'groupId is required.',
      });
    }

    await advisorRequestService.releaseAdvisor({ groupId, requesterId, reason });

    return res.status(200).json({
      status: 'ok',
      message: 'Advisor has been released from this group.',
    });
  } catch (error) {
    console.error('releaseAdvisor error:', error);

    if (error.status) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while releasing the advisor.',
    });
  }
};

module.exports = {
  createRequest,
  releaseAdvisor,
};
