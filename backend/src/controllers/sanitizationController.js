/**
 * ========================================
 * Issue #67 & #69: Post-Deadline Sanitization & Notification Protocol
 * ========================================
 * * Implements Process 3.7: Disband unassigned groups and notify members.
 */

const {
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
  checkScheduleWindowDeadline, // Fix #1: Authoritative DB check
} = require('../services/sanitizationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
const { dispatchDisbandNotification } = require('../services/notificationService');
const { markNotificationTriggered } = require('../repositories/AdvisorAssignmentRepository');
const Group = require('../models/Group');
const SyncErrorLog = require('../models/SyncErrorLog');
const pLimit = require('p-limit'); // Fix #4: Concurrency control

/**
 * FIX #2 & #4: ASYNC FIRE-AND-FORGET NOTIFICATION DISPATCH
 * * Helper function to dispatch disband notifications using parallel processing
 * with a concurrency cap (max 3) and retry logic.
 */
const dispatchDisbandNotificationsInBackground = async (disbandedGroupsIds) => {
  const limit = pLimit(3); // Fix #4: Max 3 concurrent notifications

  const notificationPromises = disbandedGroupsIds.map((groupId) =>
    limit(async () => {
      try {
        // Re-fetch group (lean) to get latest member list
        const group = await Group.findOne({ groupId })
          .select('groupId groupName members advisorRequest.requestId')
          .lean();

        if (!group) return;

        const recipients = group.members
          .filter((m) => m.status === 'accepted')
          .map((m) => m.userId);

        if (recipients.length === 0) return;

        // Use unified retry utility (3 attempts with backoff)
        const notificationResult = await retryNotificationWithBackoff(
          () =>
            dispatchDisbandNotification({
              groupId: group.groupId,
              groupName: group.groupName,
              recipients,
              reason: 'advisor_association_deadline_missed',
            }),
          {
            maxAttempts: 3,
            initialBackoffMs: 200,
            identifier: group.groupId,
            identifierType: 'groupId',
          }
        );

        // Fix #3: Persist successful dispatch flag
        if (notificationResult.success && group.advisorRequest?.requestId) {
          try {
            await markNotificationTriggered(group.advisorRequest.requestId);
          } catch (flagErr) {
            console.warn(`[Sanitization] Failed to flag request ${group.advisorRequest.requestId}:`, flagErr.message);
          }
        } else if (!notificationResult.success) {
          // Log permanent failure
          await SyncErrorLog.create({
            errorType: 'disband_notification_failed',
            sourceId: group.groupId,
            sourceType: 'group_disband',
            description: `Notification failed after 3 retries: ${notificationResult.error?.message}`,
          });
        }
      } catch (err) {
        console.error(`[Sanitization Background] Error processing group ${groupId}:`, err.message);
      }
    })
  );

  await Promise.allSettled(notificationPromises);
};

/**
 * POST /api/v1/groups/advisor-sanitization
 */
const advisorSanitization = async (req, res) => {
  try {
    const { groupIds } = req.body;
    const coordinatorId = req.user.userId;

    // Fix #5: Input Validation for groupIds
    if (groupIds !== undefined) {
      if (!Array.isArray(groupIds) || groupIds.length > 500) {
        return res.status(400).json({
          code: 'INVALID_INPUT',
          message: 'groupIds must be an array (max 500 items)',
        });
      }
    }

    // Fix #1: Authority Check - Fetch deadline from ScheduleWindow DB
    const deadlineCheckResult = await checkScheduleWindowDeadline();
    if (!deadlineCheckResult.allowed) {
      return res.status(409).json({
        code: 'DEADLINE_NOT_REACHED',
        message: deadlineCheckResult.message,
        deadlineAt: deadlineCheckResult.deadlineAt,
      });
    }

    // Fetch unassigned groups
    const unassignedGroups = await fetchUnassignedGroups(groupIds);

    if (unassignedGroups.length === 0) {
      return res.status(200).json({
        disbandedGroups: [],
        checkedAt: new Date().toISOString(),
        message: 'No unassigned groups found for sanitization',
      });
    }

    // Process DB Updates (Disband)
    const disbandResult = await disbandGroupBatch(unassignedGroups, coordinatorId, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Fix #2: FIRE-AND-FORGET
    // Return 200 OK response immediately
    res.status(200).json({
      disbandedGroups: disbandResult.disbanded_ids,
      checkedAt: new Date().toISOString(),
      message: `Sanitization complete: ${disbandResult.disbanded_count} group(s) disbanded`,
      details: {
        total_checked: unassignedGroups.length,
        errors: disbandResult.errors,
      },
    });

    // Dispatch notifications in background
    setImmediate(async () => {
      if (disbandResult.disbanded_ids.length > 0) {
        await dispatchDisbandNotificationsInBackground(disbandResult.disbanded_ids);
      }
    });

  } catch (err) {
    if (err.status && err.code) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    console.error('[Advisor Sanitization] Unexpected error:', err);
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during sanitization',
    });
  }
};

module.exports = {
  advisorSanitization,
};