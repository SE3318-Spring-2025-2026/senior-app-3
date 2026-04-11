const {
  checkDeadlineElapsed,
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
} = require('../services/sanitizationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
const { dispatchDisbandNotification } = require('../services/notificationService');
const { markNotificationTriggered } = require('../repositories/AdvisorAssignmentRepository');
const Group = require('../models/Group');
const SyncErrorLog = require('../models/SyncErrorLog');

// FIX #4: CONCURRENCY CONTROL FOR NOTIFICATION DISPATCH
// Import p-limit for parallel notification dispatch with concurrency cap
const pLimit = require('p-limit');

/**
 * FIX #2 & #4: ASYNC FIRE-AND-FORGET NOTIFICATION DISPATCH
 * 
 * DEFICIENCY #2: Response was blocking on notification retries (up to 900ms per group)
 * PROBLEM: Awaiting all notifications before returning 200 caused request timeout on batch operations
 *          50 groups * 900ms = 45 seconds of blocking I/O
 * SOLUTION: Return 200 immediately after DB updates; dispatch notifications in background
 *           using setImmediate() to execute AFTER response is sent to client
 *
 * DEFICIENCY #4: Sequential notification dispatch (for-loop with await)
 * PROBLEM: Groups notified one-at-a-time bottlenecks the event loop
 *          No parallelization opportunity; poor throughput on batch disband
 * SOLUTION: Process notifications in parallel with p-limit (3 concurrent max)
 *           Batches group notifications to avoid overwhelming Notification Service
 *           Still respects retry logic for individual failures
 *
 * Helper function to dispatch disband notifications using the unified retry utility.
 * Executes in background; failures logged to SyncErrorLog but don't block operation.
 * Notifications processed in parallel (max 3 concurrent) to prevent event loop blocking.
 *
 * @async
 * @param {object[]} disbandedGroupsData - Array of {groupId, groupName, members}
 * @returns {Promise<void>} Resolves after all notifications dispatched (success or failure)
 */
const dispatchDisbandNotificationsInBackground = async (disbandedGroupsData) => {
  // FIX #4 IMPLEMENTATION: Parallel dispatch with concurrency limit
  // Max 3 concurrent notifications to prevent overwhelming Notification Service
  const limit = pLimit(3);

  // FIX #4: Create promise array for parallel execution
  const notificationPromises = disbandedGroupsData.map((data) =>
    limit(async () => {
      const { groupId, groupName, members, advisorRequestRequestId } = data;
      const recipients = members
        .filter((m) => m.status === 'accepted')
        .map((m) => m.userId);

      if (recipients.length === 0) {
        return;
      }

      try {
        // Use unified retry utility for notification dispatch (3 attempts with backoff)
        const notificationResult = await Promise.resolve(
          retryNotificationWithBackoff(
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
          )
        );

        // FIX #3 IMPLEMENTATION: Persist notificationTriggered flag to D2 after successful dispatch
        // DEFICIENCY: Flag was only in response body, never persisted to database
        // PROBLEM: Cannot audit "was notification actually sent?" from database queries later
        // SOLUTION: Non-blocking separate update operation persists flag to MongoDB
        //           Even if flag update fails, notification was already attempted (best-effort)
        if (notificationResult.success && advisorRequestRequestId) {
          try {
            // Call repository method to update advisorRequest.notificationTriggered = true
            // This is a separate, non-blocking operation (doesn't block response)
            await markNotificationTriggered(advisorRequestRequestId);
          } catch (flagUpdateErr) {
            // Log flag update failures but don't propagate (notification already sent)
            console.warn(
              `[Sanitization] Failed to persist notificationTriggered for request ${advisorRequestRequestId} (group ${groupId}):`,
              flagUpdateErr.message
            );
          }
        } else {
          // Notification dispatch failed after retries
          // Log to SyncErrorLog for manual audit/recovery
          try {
            await SyncErrorLog.create({
              errorType: 'notification_delivery_failed',
              sourceId: groupId,
              sourceType: 'group_disband',
              description: `Disband notification delivery failed after 3 retries: ${notificationResult.error?.message}`,
              retryCount: 3,
              nextRetryAt: null, // Max retries exhausted
            });
          } catch (logErr) {
            console.error(
              `[Sanitization] Failed to log notification error for ${groupId}:`,
              logErr.message
            );
          }
        }
      } catch (err) {
        // Unexpected error during notification dispatch
        console.error(
          `[Sanitization] Unexpected error notifying group ${groupId}:`,
          err.message
        );

        // Log to SyncErrorLog for investigation
        try {
          await SyncErrorLog.create({
            errorType: 'notification_dispatch_error',
            sourceId: groupId,
            sourceType: 'group_disband',
            description: `Unexpected error during disband notification: ${err.message}`,
          });
        } catch (logErr) {
          console.error(
            `[Sanitization] Failed to log unexpected error for ${groupId}:`,
            logErr.message
          );
        }
      }
    })
  );

  // FIX #4: Execute all promises in parallel (respecting concurrency limit of 3)
  // Use Promise.allSettled to continue processing even if some fail
  // (any individual group failure shouldn't block other notifications)
  await Promise.allSettled(notificationPromises);
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
 *
 * FIX #2 IMPLEMENTATION: Fire-and-forget notification dispatch
 * - Returns 200 response immediately after DB updates
 * - Notifications dispatched asynchronously in background
 * - Failures logged to SyncErrorLog but don't block response
 * - Client receives fast response; notifications process in parallel
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
    const disbandResult = await Promise.resolve(
      disbandGroupBatch(unassignedGroups, coordinatorId, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      })
    );

    // FIX #2 IMPLEMENTATION: Return response IMMEDIATELY
    // Do NOT await notification dispatch before sending response
    // This prevents the request from timing out on batch operations
    const checkedAt = new Date().toISOString();
    const responseBody = {
      disbandedGroups: disbandResult.disbanded_ids,
      checkedAt,
      message: `Sanitization complete: ${disbandResult.disbanded_count} group(s) disbanded, ${disbandResult.failed_count} failed`,
      details: {
        total_checked: unassignedGroups.length,
        successfully_disbanded: disbandResult.disbanded_count,
        failed: disbandResult.failed_count,
        errors: disbandResult.errors,
      },
    };

    // Send 200 response to client immediately
    res.status(200).json(responseBody);

    // FIX #2 IMPLEMENTATION: Dispatch notifications asynchronously AFTER response
    // Use setImmediate to execute background task after response sent to client
    // This ensures fast response times while still processing notifications
    // Failures are logged to SyncErrorLog and don't impact response
    setImmediate(async () => {
      try {
        // Prepare group data for notification dispatch
        const disbandedGroupsForNotification = [];
        for (const groupId of disbandResult.disbanded_ids) {
          try {
            const group = await Group.findOne({ groupId }).select(
              'groupId groupName members advisorRequest.requestId'
            );
            if (group) {
              disbandedGroupsForNotification.push({
                groupId: group.groupId,
                groupName: group.groupName,
                members: group.members,
                advisorRequestRequestId: group.advisorRequest?.requestId || null,
              });
            }
          } catch (fetchErr) {
            console.error(
              `[Sanitization Background] Failed to fetch group ${groupId} for notification:`,
              fetchErr.message
            );
          }
        }

        // FIX #4: Dispatch all notifications in parallel with concurrency control
        if (disbandedGroupsForNotification.length > 0) {
          await dispatchDisbandNotificationsInBackground(disbandedGroupsForNotification);
        }
      } catch (bgErr) {
        // Log background processing errors (don't crash server)
        console.error('[Sanitization Background] Error during async notification processing:', bgErr.message);
      }
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
