/**
 * Group Advisor Management Controller
 * 
 * Handles advisor transfer (Process 3.6) and post-deadline sanitization (Process 3.7)
 * for Level 2.3 Advisor Association flows.
 * 
 * Issue #66: Coordinator Panel - Advisor Association View
 */

const Group = require('../models/Group');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const SyncErrorLog = require('../models/SyncErrorLog');
const { validateScheduleWindow } = require('../services/groupService');
const { notifyDisbandGroup } = require('../services/notificationService');

/**
 * POST /groups/:groupId/advisor/transfer
 * 
 * Process 3.6: Coordinator Transfer — Reassign group to new advisor
 * 
 * @param {string} newProfessorId - ID of the new professor/advisor
 * @param {string} coordinatorId - ID of the coordinator performing the transfer
 * @param {string} reason - Optional reason for the transfer
 * 
 * @returns {object} Updated group with advisorStatus='transferred', professorId updated
 */
const coordinatorTransferAdvisor = async (req, res) => {
  try {
    // ✅ Authorization: Coordinator role check
    if (req.user?.role !== 'coordinator') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only coordinators can transfer advisors',
        details: `User role '${req.user?.role}' does not have permission`,
      });
    }

    const { groupId } = req.params;
    const { newProfessorId, coordinatorId, reason } = req.body;

    // ✅ Validate input
    if (!newProfessorId || typeof newProfessorId !== 'string') {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'newProfessorId is required and must be a string',
      });
    }

    // ✅ Check schedule window enforcement (Process 3.4 requirement)
    const scheduleCheck = await validateScheduleWindow('advisor_association');
    if (!scheduleCheck.isOpen) {
      return res.status(422).json({
        code: 'SCHEDULE_CLOSED',
        message: 'Advisor association schedule is closed',
        details: `Window opens at ${scheduleCheck.window?.open_at}`,
      });
    }

    // ✅ Verify group exists
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Group not found',
        details: `Group ID: ${groupId}`,
      });
    }

    // ✅ Verify new professor exists and has professor/admin role
    const professor = await User.findOne({ userId: newProfessorId });
    if (!professor) {
      return res.status(400).json({
        code: 'INVALID_ADVISOR',
        message: 'Professor not found',
        details: `Professor ID: ${newProfessorId}`,
      });
    }

    if (!['professor', 'admin'].includes(professor.role)) {
      return res.status(400).json({
        code: 'INVALID_ADVISOR',
        message: 'User is not a professor or admin',
        details: `User role: ${professor.role}`,
      });
    }

    // ✅ Check for conflicts: ensure target professor is not overbooked
    // (Simple check: professor not already assigned to this group)
    if (group.professorId === newProfessorId) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'Professor already assigned to this group',
        details: `Professor ${newProfessorId} is the current advisor`,
      });
    }

    // ✅ Update group with new advisor
    const oldProfessorId = group.professorId;
    group.professorId = newProfessorId;
    group.advisorStatus = 'transferred';
    group.advisorUpdatedAt = new Date();
    
    await group.save();

    // ✅ Audit log for transfer (Process 3.5 audit record)
    try {
      await AuditLog.create({
        actorId: coordinatorId || req.user?.userId,
        entityType: 'Group',
        entityId: groupId,
        action: 'advisor_transfer',
        payload: {
          oldProfessorId,
          newProfessorId,
          reason: reason || 'No reason provided',
          scheduledBy: coordinatorId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      console.error('Audit log creation failed:', auditErr);
      // Log sync error but continue
      try {
        await SyncErrorLog.create({
          operation: 'advisor_transfer_audit',
          entityId: groupId,
          error: auditErr.message,
        });
      } catch (syncErr) {
        console.error('Sync error log failed:', syncErr);
      }
    }

    // ✅ Return updated group
    return res.status(200).json({
      success: true,
      code: 'TRANSFER_SUCCESS',
      group: {
        groupId: group.groupId,
        groupName: group.groupName,
        leaderId: group.leaderId,
        professorId: group.professorId,
        advisorStatus: group.advisorStatus,
        advisorUpdatedAt: group.advisorUpdatedAt,
        status: group.status,
      },
      message: `Group transferred to new advisor ${newProfessorId}`,
    });
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
 * 
 * Finds all groups without an assigned advisor (advisorStatus !== 'assigned')
 * and disbands them, dispatching disband notices.
 * 
 * @param {Date} scheduleDeadline - Optional deadline timestamp
 * @param {string[]} groupIds - Optional list of specific group IDs to sanitize
 * 
 * @returns {object} { disbandedGroups[], checkedAt, message, count }
 */
const disbandUnassignedGroups = async (req, res) => {
  try {
    // ✅ Authorization: Coordinator or Admin/System role check
    const allowedRoles = ['coordinator', 'admin'];
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only coordinators or admins can trigger sanitization',
        details: `User role '${req.user?.role}' does not have permission`,
      });
    }

    const { scheduleDeadline, groupIds } = req.body;
    const checkedAt = new Date();

    // ✅ Extract deadline from request or use current time
    let deadline = scheduleDeadline ? new Date(scheduleDeadline) : checkedAt;
    
    // ✅ Validate deadline: if provided, should not be in the future (i.e., deadline should have passed)
    if (scheduleDeadline && deadline > checkedAt) {
      return res.status(409).json({
        code: 'DEADLINE_NOT_PASSED',
        message: 'Sanitization triggered before the configured deadline',
        details: `Deadline: ${deadline.toISOString()}, Current: ${checkedAt.toISOString()}`,
      });
    }

    // ✅ Build query for unassigned groups
    let query = {
      advisorStatus: { $ne: 'assigned' }, // Not yet assigned (pending, released, disbanded, etc.)
    };

    // If specific groupIds provided, filter to those only
    if (Array.isArray(groupIds) && groupIds.length > 0) {
      query.groupId = { $in: groupIds };
    }

    // ✅ Fetch unassigned groups
    const unassignedGroups = await Group.find(query).lean();

    if (unassignedGroups.length === 0) {
      return res.status(200).json({
        success: true,
        code: 'NO_GROUPS_TO_SANITIZE',
        disbandedGroups: [],
        checkedAt,
        message: 'No unassigned groups found to disband',
        count: 0,
      });
    }

    // ✅ Disband each group and log audit
    const disbandedGroupIds = [];
    const updateResults = [];

    for (const groupData of unassignedGroups) {
      try {
        // Update group status to disbanded
        const updated = await Group.findOneAndUpdate(
          { groupId: groupData.groupId },
          {
            advisorStatus: 'disbanded',
            advisorUpdatedAt: checkedAt,
            // Optionally also mark group as archived if not already
            // status: 'archived', // Commented out to preserve existing group status
          },
          { new: true }
        );

        if (updated) {
          disbandedGroupIds.push(updated.groupId);
          updateResults.push({
            groupId: updated.groupId,
            status: 'success',
          });

          // ✅ Create audit log for disband action
          try {
            await AuditLog.create({
              actorId: req.user?.userId,
              entityType: 'Group',
              entityId: groupData.groupId,
              action: 'advisor_disband',
              payload: {
                reason: 'Post-deadline sanitization',
                formerAdvisorStatus: groupData.advisorStatus,
              },
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
            });
          } catch (auditErr) {
            console.error(`Audit log failed for group ${groupData.groupId}:`, auditErr);
          }

          // ✅ Dispatch disband notification to group members (Process 3.7 → Notification Service)
          try {
            const group = await Group.findOne({ groupId: groupData.groupId });
            if (group && group.members && group.members.length > 0) {
              await notifyDisbandGroup(group, req.user?.userId);
            }
          } catch (notifyErr) {
            console.error(`Notification dispatch failed for group ${groupData.groupId}:`, notifyErr);
            // Continue even if notification fails; disband is already done
          }
        }
      } catch (updateErr) {
        console.error(`Failed to disband group ${groupData.groupId}:`, updateErr);
        updateResults.push({
          groupId: groupData.groupId,
          status: 'failed',
          error: updateErr.message,
        });
      }
    }

    // ✅ Log sanitization operation to audit trail
    try {
      await AuditLog.create({
        actorId: req.user?.userId,
        entityType: 'System',
        entityId: 'advisor-sanitization',
        action: 'sanitization_run',
        payload: {
          checkedAt,
          disbandedCount: disbandedGroupIds.length,
          totalChecked: unassignedGroups.length,
          results: updateResults,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditErr) {
      console.error('Sanitization audit log failed:', auditErr);
    }

    // ✅ Return results
    return res.status(200).json({
      success: true,
      code: 'SANITIZATION_COMPLETE',
      disbandedGroups: disbandedGroupIds,
      checkedAt,
      message: `Sanitization complete. ${disbandedGroupIds.length} groups disbanded.`,
      count: disbandedGroupIds.length,
      details: updateResults,
    });
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
