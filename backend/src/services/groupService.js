/**
 * Group Service — Process 2.5 forwarding (DFD flow f03: 2.2 → 2.5)
 *
 * After Process 2.2 validates and writes the group record to D2,
 * the validated group data is forwarded to Process 2.5 (member request
 * processing pipeline). This service initialises the member list by
 * adding the leader as the first confirmed member, making the group
 * ready to receive further membership requests.
 */

const { activateGroup } = require('./groupStatusTransition');
const Group = require('../models/Group');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { notifyDisbandGroup } = require('./notificationService');

/**
 * Forward validated group data to the member request processing pipeline.
 * Adds the leader as an accepted member (initial state for Process 2.5).
 *
 * After this function completes, the group automatically transitions to
 * ACTIVE status once validation + processing is complete (Issue #52).
 *
 * @param {object} group - Mongoose Group document (already saved to D2)
 * @returns {object} Updated group document
 */
const forwardToMemberRequestPipeline = async (group) => {
  const leaderAlreadyAdded = group.members.some((m) => m.userId === group.leaderId);

  if (!leaderAlreadyAdded) {
    group.members.push({
      userId: group.leaderId,
      role: 'leader',
      status: 'accepted',
      joinedAt: new Date(),
    });
    await group.save();
  }

  // Issue #52: Automatically activate group after member request pipeline processing
  try {
    const updatedGroup = await activateGroup(group.groupId, {
      actorId: group.leaderId, // System-triggered by leader setup
      reason: 'Automatic activation after validation and member request pipeline processing',
      ipAddress: null,
      userAgent: null,
    });
    return updatedGroup;
  } catch (err) {
    console.warn(`Auto-activation failed for group ${group.groupId}:`, err.message);
    // Return original group if activation fails; pipeline continues
    return group;
  }
};

/**
 * Forward override confirmation to process 2.5 for reconciliation.
 * (DFD flow f17: 2.8 → 2.5)
 *
 * @param {object} override - Mongoose Override document (already saved to D2)
 * @returns {object} Updated override document
 */
const forwardOverrideToReconciliation = async (override) => {
  override.status = 'reconciled';
  override.reconciledAt = new Date();
  await override.save();
  return override;
};

/**
 * Issue #66: Validate schedule window for advisor association operations
 * 
 * Checks if the current time falls within the configured open_at and close_at
 * window for the advisor_association operation type.
 * 
 * @param {string} operationType - Operation type (e.g., 'advisor_association')
 * @returns {Promise} { isOpen: boolean, message: string, window: { open_at, close_at } }
 */
const validateScheduleWindow = async (operationType = 'advisor_association') => {
  const ScheduleWindow = require('../models/ScheduleWindow');
  
  try {
    const window = await ScheduleWindow.findOne({ operationType });

    if (!window) {
      // No schedule configured, assume open
      return {
        isOpen: true,
        message: 'No schedule window configured',
        window: null,
      };
    }

    const now = new Date();
    const openAt = new Date(window.startsAt);
    const closeAt = new Date(window.endsAt);

    const isOpen = now >= openAt && now <= closeAt;

    return {
      isOpen,
      message: isOpen
        ? `Schedule window is open (${openAt.toISOString()} to ${closeAt.toISOString()})`
        : `Schedule window is closed. Opens at ${openAt.toISOString()}, closes at ${closeAt.toISOString()}`,
      window: {
        open_at: openAt,
        close_at: closeAt,
      },
    };
  } catch (error) {
    console.error('Error checking schedule window:', error);
    throw error;
  }
};

/**
 * Process 3.6 — Execute advisor transfer (persist group, audit).
 * Caller must enforce auth (coordinator/admin). Returns { ok, status?, body } for HTTP mapping.
 *
 * @param {string} groupId
 * @param {string} newProfessorId
 * @param {string} [reason]
 * @param {{ userId: string, coordinatorId?: string|null, ipAddress?: string, userAgent?: string }} actor
 */
const executeAdvisorTransfer = async (groupId, newProfessorId, reason, actor) => {
  if (!newProfessorId || typeof newProfessorId !== 'string') {
    return {
      ok: false,
      status: 400,
      body: {
        code: 'INVALID_INPUT',
        message: 'newProfessorId is required and must be a string',
      },
    };
  }

  const scheduleCheck = await validateScheduleWindow('advisor_association');
  if (!scheduleCheck.isOpen) {
    return {
      ok: false,
      status: 422,
      body: {
        code: 'SCHEDULE_CLOSED',
        message: 'Advisor association schedule is closed',
        details: `Window opens at ${scheduleCheck.window?.open_at}`,
      },
    };
  }

  const group = await Group.findOne({ groupId });
  if (!group) {
    return {
      ok: false,
      status: 404,
      body: {
        code: 'NOT_FOUND',
        message: 'Group not found',
        details: `Group ID: ${groupId}`,
      },
    };
  }

  const professor = await User.findOne({ userId: newProfessorId });
  if (!professor) {
    return {
      ok: false,
      status: 400,
      body: {
        code: 'INVALID_ADVISOR',
        message: 'Professor not found',
        details: `Professor ID: ${newProfessorId}`,
      },
    };
  }

  if (!['professor', 'admin'].includes(professor.role)) {
    return {
      ok: false,
      status: 400,
      body: {
        code: 'INVALID_ADVISOR',
        message: 'User is not a professor or admin',
        details: `User role: ${professor.role}`,
      },
    };
  }

  if (group.professorId === newProfessorId) {
    return {
      ok: false,
      status: 409,
      body: {
        code: 'CONFLICT',
        message: 'Professor already assigned to this group',
        details: `Professor ${newProfessorId} is the current advisor`,
      },
    };
  }

  const oldProfessorId = group.professorId;
  const coordinatorId = actor?.coordinatorId;
  group.professorId = newProfessorId;
  group.advisorStatus = 'transferred';
  group.advisorUpdatedAt = new Date();
  await group.save();

  try {
    await AuditLog.create({
      actorId: coordinatorId || actor?.userId,
      groupId,
      action: 'advisor_transfer',
      payload: {
        oldProfessorId,
        newProfessorId,
        reason: reason || 'No reason provided',
        scheduledBy: coordinatorId,
      },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
  } catch (auditErr) {
    console.error('Audit log creation failed:', auditErr);
  }

  return {
    ok: true,
    status: 200,
    body: {
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
    },
  };
};

/**
 * Process 3.7 — Disband unassigned groups. Caller must enforce auth (coordinator/admin).
 *
 * @param {{ userId: string, ipAddress?: string, userAgent?: string }} actor
 * @param {{ scheduleDeadline?: string|Date, groupIds?: string[] }} [options]
 */
const executeAdvisorSanitization = async (actor, options = {}) => {
  const { scheduleDeadline, groupIds } = options;
  const checkedAt = new Date();
  let deadline = scheduleDeadline ? new Date(scheduleDeadline) : checkedAt;

  if (scheduleDeadline && deadline > checkedAt) {
    return {
      ok: false,
      status: 409,
      body: {
        code: 'DEADLINE_NOT_PASSED',
        message: 'Sanitization triggered before the configured deadline',
        details: `Deadline: ${deadline.toISOString()}, Current: ${checkedAt.toISOString()}`,
      },
    };
  }

  let query = {
    advisorStatus: { $ne: 'assigned' },
  };

  if (Array.isArray(groupIds) && groupIds.length > 0) {
    query.groupId = { $in: groupIds };
  }

  const unassignedGroups = await Group.find(query).lean();

  if (unassignedGroups.length === 0) {
    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        code: 'NO_GROUPS_TO_SANITIZE',
        disbandedGroups: [],
        checkedAt,
        message: 'No unassigned groups found to disband',
        count: 0,
      },
    };
  }

  const disbandedGroupIds = [];
  const updateResults = [];

  for (const groupData of unassignedGroups) {
    try {
      const updated = await Group.findOneAndUpdate(
        { groupId: groupData.groupId },
        {
          advisorStatus: 'disbanded',
          advisorUpdatedAt: checkedAt,
        },
        { new: true }
      );

      if (updated) {
        disbandedGroupIds.push(updated.groupId);
        updateResults.push({
          groupId: updated.groupId,
          status: 'success',
        });

        try {
          await AuditLog.create({
            actorId: actor?.userId,
            groupId: groupData.groupId,
            action: 'advisor_disband',
            payload: {
              reason: 'Post-deadline sanitization',
              formerAdvisorStatus: groupData.advisorStatus,
            },
            ipAddress: actor?.ipAddress,
            userAgent: actor?.userAgent,
          });
        } catch (auditErr) {
          console.error(`Audit log failed for group ${groupData.groupId}:`, auditErr);
        }

        try {
          const group = await Group.findOne({ groupId: groupData.groupId });
          if (group && group.members && group.members.length > 0) {
            await notifyDisbandGroup(group, actor?.userId);
          }
        } catch (notifyErr) {
          console.error(`Notification dispatch failed for group ${groupData.groupId}:`, notifyErr);
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

  try {
    await AuditLog.create({
      actorId: actor?.userId,
      targetId: 'advisor-sanitization',
      action: 'sanitization_run',
      payload: {
        checkedAt,
        disbandedCount: disbandedGroupIds.length,
        totalChecked: unassignedGroups.length,
        results: updateResults,
      },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
  } catch (auditErr) {
    console.error('Sanitization audit log failed:', auditErr);
  }

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      code: 'SANITIZATION_COMPLETE',
      disbandedGroups: disbandedGroupIds,
      checkedAt,
      message: `Sanitization complete. ${disbandedGroupIds.length} groups disbanded.`,
      count: disbandedGroupIds.length,
      details: updateResults,
    },
  };
};

module.exports = {
  forwardToMemberRequestPipeline,
  forwardOverrideToReconciliation,
  // Issue #52: Export transition functions for group lifecycle management
  activateGroup,
  // Issue #66: Schedule window validation for advisor association
  validateScheduleWindow,
  executeAdvisorTransfer,
  executeAdvisorSanitization,
};
