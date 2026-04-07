/**
 * Group Status Transition Controller
 * Issue #52: Group Status Transitions & Lifecycle Management
 *
 * Endpoints for managing group status transitions.
 * - PATCH /api/v1/groups/:groupId/status - Transition group to new status
 * - GET /api/v1/groups/:groupId/status - Retrieve current group status
 */

const Group = require('../models/Group');
const { createAuditLog } = require('../services/auditService');
const {
  transitionGroupStatus,
  validateTransition,
} = require('../services/groupStatusTransition');
const { VALID_STATUS_TRANSITIONS } = require('../utils/groupStatusEnum');

/**
 * PATCH /api/v1/groups/:groupId/status
 *
 * Transition a group to a new status.
 * Only coordinators, committee members, or admins can trigger transitions.
 *
 * Request body:
 * {
 *   "status": "active|inactive|rejected",
 *   "reason": "string (required)"
 * }
 *
 * Returns:
 * - 200: Status transition successful
 * - 400: Invalid request (missing required fields)
 * - 404: Group not found
 * - 409: Conflict (invalid status transition)
 * - 403: Forbidden (insufficient permission)
 * - 500: Server error
 */
const transitionStatus = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status: targetStatus, reason } = req.body;

    // Validate permission: only coordinators, committee members, or admins
    const allowedRoles = new Set(['coordinator', 'committee_member', 'admin', 'professor']);
    if (!allowedRoles.has(req.user.role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This action requires coordinator, committee member, admin, or professor role',
      });
    }

    // Validate required fields
    if (!targetStatus || typeof targetStatus !== 'string') {
      return res.status(400).json({
        code: 'MISSING_STATUS',
        message: 'status is required and must be a string',
      });
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({
        code: 'MISSING_REASON',
        message: 'reason is required and must be a non-empty string',
      });
    }

    // Fetch the group
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const currentStatus = group.status;

    // Validate the transition is allowed
    const validation = validateTransition(currentStatus, targetStatus);
    if (!validation.isValid) {
      return res.status(409).json({
        code: 'INVALID_STATUS_TRANSITION',
        message: validation.reason,
        current_status: currentStatus,
        attempted_status: targetStatus,
        allowed_transitions: validation.allowed ? [...validation.allowed] : [],
      });
    }

    // Perform the transition
    const updatedGroup = await transitionGroupStatus(groupId, targetStatus, {
      actorId: req.user.userId,
      reason: reason.trim(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Audit log already created by transitionGroupStatus
    // Create additional coordinator_override log if triggered by coordinator
    if (req.user.role === 'coordinator') {
      try {
        await createAuditLog({
          action: 'coordinator_override',
          actorId: req.user.userId,
          targetId: groupId,
          groupId,
          payload: {
            action: 'status_transition',
            from_status: currentStatus,
            to_status: targetStatus,
            reason: reason.trim(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('coordinator_override audit log failed (non-fatal):', auditError.message);
      }
    }

    return res.status(200).json({
      groupId,
      previous_status: currentStatus,
      new_status: targetStatus,
      reason: reason.trim(),
      timestamp: new Date().toISOString(),
      message: `Group status transitioned from '${currentStatus}' to '${targetStatus}'`,
    });
  } catch (error) {
    console.error('transitionStatus error:', error);

    // Handle specific error codes
    if (error.code === 'INVALID_STATUS_TRANSITION') {
      return res.status(409).json({
        code: 'INVALID_STATUS_TRANSITION',
        message: error.message,
        current_status: error.current,
        attempted_status: error.attempted,
        allowed_transitions: error.allowed || [],
      });
    }

    if (error.code === 'GROUP_NOT_FOUND') {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: error.message,
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred during status transition',
    });
  }
};

/**
 * GET /api/v1/groups/:groupId/status
 *
 * Retrieve the current status of a group.
 *
 * Returns:
 * - 200: Current status and transition information
 * - 404: Group not found
 * - 500: Server error
 */
const getStatus = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const currentStatus = group.status;
    const allowedTransitions = [...(VALID_STATUS_TRANSITIONS[currentStatus] || new Set())];

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: 'GROUP_RETRIEVED',
        actorId: req.user?.userId || null,
        targetId: groupId,
        groupId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      groupId,
      current_status: currentStatus,
      possible_transitions: allowedTransitions,
      updated_at: group.updatedAt,
    });
  } catch (error) {
    console.error('getStatus error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while retrieving group status',
    });
  }
};

module.exports = {
  transitionStatus,
  getStatus,
};
