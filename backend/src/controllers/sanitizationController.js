const {
  checkDeadlineElapsed,
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
} = require('../services/sanitizationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
const { dispatchDisbandNotification } = require('../services/notificationService');
const Group = require('../models/Group');

/**
 * Helper function to dispatch disband notifications using the unified retry utility.
 * Non-fatal: failures logged to SyncErrorLog but don't block operation.
 *
 * @async
 * @param {string} groupId
 * @param {string} groupName
 * @param {object[]} members
 * @returns {Promise<{notificationTriggered: boolean, lastError: null|Error}>}
 */
/* eslint-disable no-await-in-loop */
const dispatchDisbandNotifications = async (groupId, groupName, members) => {
  const recipients = members
    .filter((m) => m.status === 'accepted')
    .map((m) => m.userId);

  if (recipients.length === 0) {
    return { notificationTriggered: false, lastError: null };
  }

  // Use unified retry utility instead of manual retry loop
  const notificationResult = await Promise.resolve(retryNotificationWithBackoff(
    () =>
      dispatchDisbandNotification({
        groupId,
        groupName,
        recipients,
        reason: 'advisor_association_deadline_missed',
      }),
    {
      maxAttempts: 3,
      initialBackoffMs: 100,
      identifier: groupId,
      identifierType: 'groupId',
    }
  ));

  return {
    notificationTriggered: notificationResult.success,
    lastError: notificationResult.error,
  };
};

/**
 * POST /api/v1/groups/advisor-sanitization
 * Process 3.7: Disband unassigned groups after advisor association deadline.
 *
 * Authorization: Coordinator or Admin only (403 otherwise)
 * Deadline Check: 409 if triggered before deadline passes
 *
 * Request body:
 *   - scheduleDeadline (required): ISO datetime string of deadline
 *   - groupIds (optional): Array of specific group IDs to check
 *
 * Response (200):
 *   - disbandedGroups: array of group IDs that were disbanded
 *   - checkedAt: ISO timestamp when sanitization was run
 *   - message: summary message
 */
/* eslint-disable no-await-in-loop */
const advisorSanitization = async (req, res) => {
  try {
    const { scheduleDeadline, groupIds } = req.body;
    const coordinatorId = req.user.userId;

    // Input validation
    if (!scheduleDeadline) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'scheduleDeadline is required',
      });
    }

    // Check if deadline has elapsed
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve(checkDeadlineElapsed(scheduleDeadline));

    // Fetch unassigned groups
    // eslint-disable-next-line no-await-in-loop
    const unassignedGroups = await Promise.resolve(fetchUnassignedGroups(groupIds));

    if (unassignedGroups.length === 0) {
      return res.status(200).json({
        disbandedGroups: [],
        checkedAt: new Date().toISOString(),
        message: 'No unassigned groups found for sanitization',
      });
    }

    // Disband all unassigned groups
    // eslint-disable-next-line no-await-in-loop
    const disbandResult = await Promise.resolve(disbandGroupBatch(unassignedGroups, coordinatorId, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    }));

    // Dispatch notifications for each disbanded group
    const disbandedGroupIds = [];
    for (const groupId of disbandResult.disbanded_ids) {
      try {
        // Re-fetch group for current state
        const group = await Group.findOne({ groupId }).select(
          'groupId groupName members'
        );

        if (group) {
          // Use unified retry utility for notification dispatch
          const { notificationTriggered } = await Promise.resolve(dispatchDisbandNotifications(
            group.groupId,
            group.groupName,
            group.members
          ));

          disbandedGroupIds.push({
            groupId: group.groupId,
            notificationTriggered,
          });
        }
      } catch (err) {
        console.error(
          `Failed to notify members of disbanded group ${groupId}:`,
          err.message
        );
      }
    }

    return res.status(200).json({
      disbandedGroups: disbandedGroupIds.map((g) => g.groupId),
      checkedAt: new Date().toISOString(),
      message: `Sanitization complete: ${disbandResult.disbanded_count} group(s) disbanded, ${disbandResult.failed_count} failed`,
      details: {
        total_checked: unassignedGroups.length,
        successfully_disbanded: disbandResult.disbanded_count,
        failed: disbandResult.failed_count,
        errors: disbandResult.errors,
      },
    });
  } catch (err) {
    // Handle SanitizationServiceError (deadline check failures)
    if (err.status && err.code) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    // Handle unexpected errors
    console.error('[Advisor Sanitization] Unexpected error:', err);
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during sanitization',
      error: err.message,
    });
  }
};

module.exports = {
  advisorSanitization,
};
