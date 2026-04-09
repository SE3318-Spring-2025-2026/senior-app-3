const { checkDeadlineElapsed, fetchUnassignedGroups, disbandGroupBatch, SanitizationServiceError } = require('../services/sanitizationService');
const { dispatchDisbandNotification } = require('../services/notificationService');

/**
 * dispatchDisbandNotifications(disbandedGroups)
 *
 * Helper: Dispatch disband notifications for each disbanded group.
 * Non-fatal: individual notification failures don't block others.
 */
async function dispatchDisbandNotifications(disbandedGroups) {
  for (const group of disbandedGroups) {
    try {
      await dispatchDisbandNotification({
        groupId: group.groupId,
        groupName: group.groupName,
        recipients: group.membersNotified,
        reason: 'Your group has been disbanded due to unassigned advisor deadline.',
      });
    } catch (err) {
      console.error(`[Sanitization] Failed to dispatch disband notification for ${group.groupId}:`, err.message);
      // Non-fatal: continue with next group
    }
  }
}

/**
 * advisorSanitization(req, res)
 *
 * POST /groups/advisor-sanitization
 * Process 3.7 (Disband Unassigned Groups)
 *
 * Coordinator-initiated sanitization: disband all active groups without an advisor
 * after the configured deadline. Dispatch disband notices to group members.
 *
 * Authorization: Coordinator or System only (403 otherwise).
 * Note: NOT subject to schedule middleware (uses deadline-based gating instead).
 *
 * @param {Date|string} req.body.scheduleDeadline — ISO date string (required)
 * @param {string[]} req.body.groupIds — Optional: specific group IDs to disband
 */
async function advisorSanitization(req, res) {
  try {
    const { scheduleDeadline, groupIds } = req.body;
    const coordinatorId = req.user?.id;

    if (!coordinatorId) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    // Verify role is coordinator or system
    if (req.user?.role !== 'coordinator' && req.user?.role !== 'admin' && req.user?.role !== 'system') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only coordinators can trigger sanitization',
      });
    }

    // Input validation
    if (!scheduleDeadline) {
      return res.status(400).json({
        code: 'MISSING_FIELD',
        message: 'scheduleDeadline is required (ISO date string)',
      });
    }

    // Validate deadline has elapsed
    try {
      checkDeadlineElapsed(scheduleDeadline);
    } catch (err) {
      if (err instanceof SanitizationServiceError) {
        return res.status(err.status).json({ code: err.code, message: err.message });
      }
      throw err;
    }

    // Fetch unassigned groups
    const unassignedGroups = await fetchUnassignedGroups(groupIds);
    const groupIdsToDisband = unassignedGroups.map((g) => g.groupId);

    if (groupIdsToDisband.length === 0) {
      return res.status(200).json({
        disbandedGroups: [],
        checkedAt: new Date().toISOString(),
        message: 'No unassigned groups found for disband',
        details: { groupsChecked: 0, groupsDisbanded: 0, failedGroups: 0 },
      });
    }

    // Batch disband operation
    const { disbandedGroups, failedGroups } = await disbandGroupBatch(groupIdsToDisband, coordinatorId, {
      reason: 'Advisor assignment deadline elapsed',
    });

    // Dispatch disband notifications (non-fatal)
    await dispatchDisbandNotifications(disbandedGroups);

    return res.status(200).json({
      disbandedGroups: disbandedGroups.map((g) => ({
        groupId: g.groupId,
        groupName: g.groupName,
        membersNotified: g.membersNotified.length,
      })),
      failedGroups,
      checkedAt: new Date().toISOString(),
      message: `Sanitization completed: ${disbandedGroups.length} groups disbanded, ${failedGroups.length} failed`,
      details: {
        groupsChecked: unassignedGroups.length,
        groupsDisbanded: disbandedGroups.length,
        failedGroups: failedGroups.length,
      },
    });
  } catch (err) {
    console.error('[advisorSanitization]', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
}

module.exports = {
  advisorSanitization,
};
