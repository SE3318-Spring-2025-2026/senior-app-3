/**
 * Group Advisor Management Controller
 *
 * Handles advisor transfer (Process 3.6) and post-deadline sanitization (Process 3.7)
 * for Level 2.3 Advisor Association flows. Business logic lives in groupService.
 *
 * Issue #66: Coordinator Panel - Advisor Association View
 */

const { executeAdvisorTransfer, executeAdvisorSanitization } = require('../services/groupService');

/**
 * POST /groups/:groupId/advisor/transfer
 *
 * Process 3.6: Coordinator Transfer — Reassign group to new advisor
 */
const coordinatorTransferAdvisor = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { newProfessorId, coordinatorId, reason } = req.body;

    const result = await executeAdvisorTransfer(groupId, newProfessorId, reason, {
      userId: req.user?.userId,
      coordinatorId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Transfer advisor error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to transfer advisor',
      details: error.message,
    });
  }
};

/**
 * POST /groups/advisor-sanitization
 *
 * Process 3.7: Disband Unassigned Groups — Sanitization Protocol
 */
const disbandUnassignedGroups = async (req, res) => {
  try {
    const { scheduleDeadline, groupIds } = req.body;

    const result = await executeAdvisorSanitization(
      {
        userId: req.user?.userId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
      { scheduleDeadline, groupIds }
    );

    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Sanitization error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to execute sanitization',
      details: error.message,
    });
  }
};

module.exports = {
  coordinatorTransferAdvisor,
  disbandUnassignedGroups,
};
