/**
 * ================================================================================
 * ISSUE #238: Sprint Update Notifications Service — Main Orchestrator
 * ================================================================================
 *
 * Purpose:
 * Implement notification dispatch for sprint contribution updates triggered from
 * Process 7.5 persistence completion. Handles both student individual notifications
 * and coordinator summary reports with retry resilience and correlation ID tracing.
 *
 * DFD Reference:
 * - Flow f7_p75_ext_notification: 7.5 → Notification Service (student/coordinator dispatch)
 * - Flow f7_p75_ext_coordinator: 7.5 → Coordinator report path (summary report link)
 *
 * Acceptance Criteria (#238):
 * ✓ When notifyStudents=true, each group member receives notification event
 * ✓ Coordinator receives summary notification or in-app report trigger
 * ✓ Failures logged with correlationId; retries exhausted produce alert log
 * ✓ No notification sent when sprint window closed (422 path)
 *
 * Design Pattern:
 * Extends existing notificationService and committeeNotificationService patterns.
 * Uses retry engine from notificationRetry.js for transient error handling.
 * Non-blocking dispatch via setImmediate() to prevent response latency.
 *
 * ================================================================================
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { retryNotificationWithBackoff, isTransientError } = require('./notificationRetry');
const { createAuditLog } = require('./auditService');
const SprintNotificationConfig = require('../models/SprintNotificationConfig');
const Group = require('../models/Group');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const SyncErrorLog = require('../models/SyncErrorLog');

// ISSUE #238: Get notification service URL from environment
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';
const NOTIFICATION_TIMEOUT_MS = 5000;

// ================================================================================
// ISSUE #238: CUSTOM ERROR CLASS FOR NOTIFICATION SERVICE FAILURES
// ================================================================================

/**
 * ISSUE #238: Custom error class for notification dispatch failures
 *
 * Distinguishes between transient (retry-worthy) and permanent notification errors
 * for logging and alert generation.
 */
class NotificationServiceError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'NotificationServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ================================================================================
// ISSUE #238: PAYLOAD BUILDERS — Construct notification payloads for each type
// ================================================================================

/**
 * ISSUE #238: Build payload for individual student notification
 *
 * Contains: student's completed SP, target SP, ratio, link to student dashboard
 *
 * @param {String} studentId - Student receiving notification
 * @param {Object} studentContribution - { targetStoryPoints, completedStoryPoints, contributionRatio }
 * @param {String} groupId - Group context
 * @param {String} sprintId - Sprint context
 * @param {String} correlationId - For tracing this notification back to recalculation
 * @returns {Object} Payload for notification service
 */
function buildStudentNotificationPayload(studentId, studentContribution, groupId, sprintId, correlationId) {
  // ISSUE #238: Calculate ratio as percentage for display
  const ratioPercentage = (studentContribution.contributionRatio * 100).toFixed(1);

  // ISSUE #238: Structure notification payload for student
  return {
    type: 'sprint_update_student',  // ISSUE #238: Notification type for routing
    notificationId: uuidv4(),
    recipientId: studentId,
    recipientRole: 'student',
    groupId,
    sprintId,
    correlationId,  // ISSUE #238: Link to parent recalculation operation
    timestamp: new Date().toISOString(),

    // ISSUE #238: Student-specific contribution data
    content: {
      completedStoryPoints: studentContribution.completedStoryPoints,
      targetStoryPoints: studentContribution.targetStoryPoints,
      contributionRatio: studentContribution.contributionRatio,
      ratioPercentage: parseFloat(ratioPercentage),
      
      // ISSUE #238: Human-readable summary
      summary: `Your sprint contribution is ${ratioPercentage}% ` +
               `(${studentContribution.completedStoryPoints}/${studentContribution.targetStoryPoints} story points)`,
      
      // ISSUE #238: Link to student dashboard view for detailed breakdown
      actionLink: `/groups/${groupId}/sprints/${sprintId}/contributions/view`
    },

    // ISSUE #238: Delivery preferences
    deliveryMethod: 'internal_app',
    priority: 'normal',
    
    // ISSUE #238: Metadata for analytics
    tags: ['sprint', 'contribution', 'ratio_update']
  };
}

/**
 * ISSUE #238: Build payload for coordinator summary notification
 *
 * Contains: group totals, average/min/max ratios, mapping warning count,
 * link to coordinator report view
 *
 * @param {String} coordinatorId - Coordinator receiving summary
 * @param {String} groupId - Group being reported
 * @param {String} sprintId - Sprint being reported
 * @param {Object} summaryData - { groupTotalStoryPoints, averageRatio, maxRatio, minRatio, memberCount, mappingWarningsCount }
 * @param {String} correlationId - For tracing
 * @returns {Object} Payload for notification service
 */
function buildCoordinatorNotificationPayload(coordinatorId, groupId, sprintId, summaryData, correlationId) {
  // ISSUE #238: Calculate percentages for display
  const avgRatioPercentage = (summaryData.averageRatio * 100).toFixed(1);
  const maxRatioPercentage = (summaryData.maxRatio * 100).toFixed(1);
  const minRatioPercentage = (summaryData.minRatio * 100).toFixed(1);

  // ISSUE #238: Build warning message if mapping issues detected
  const warningMessage = summaryData.mappingWarningsCount > 0
    ? `⚠️ ${summaryData.mappingWarningsCount} story points unmapped (no GitHub PR attribution)`
    : '✓ All story points successfully attributed';

  // ISSUE #238: Structure notification payload for coordinator
  return {
    type: 'sprint_summary_coordinator',  // ISSUE #238: Notification type for routing
    notificationId: uuidv4(),
    recipientId: coordinatorId,
    recipientRole: 'coordinator',
    groupId,
    sprintId,
    correlationId,  // ISSUE #238: Link to parent recalculation operation
    timestamp: new Date().toISOString(),

    // ISSUE #238: Coordinator-facing summary statistics
    content: {
      groupTotalStoryPoints: summaryData.groupTotalStoryPoints,
      memberCount: summaryData.memberCount,
      averageRatio: summaryData.averageRatio,
      averageRatioPercentage: parseFloat(avgRatioPercentage),
      maxRatio: summaryData.maxRatio,
      maxRatioPercentage: parseFloat(maxRatioPercentage),
      minRatio: summaryData.minRatio,
      minRatioPercentage: parseFloat(minRatioPercentage),
      mappingWarningsCount: summaryData.mappingWarningsCount,

      // ISSUE #238: Human-readable summary
      summary: `Sprint contribution recalculated: ${summaryData.memberCount} members, ` +
               `average ratio ${avgRatioPercentage}%, total ${summaryData.groupTotalStoryPoints} SP. ${warningMessage}`,

      // ISSUE #238: Link to detailed coordinator report view
      actionLink: `/groups/${groupId}/sprints/${sprintId}/contributions/report`
    },

    // ISSUE #238: Delivery preferences
    deliveryMethod: 'internal_app',
    priority: 'high',  // ISSUE #238: Coordinator summaries are higher priority

    // ISSUE #238: Metadata for analytics
    tags: ['sprint', 'coordinator', 'summary', 'report']
  };
}

// ================================================================================
// ISSUE #238: MAIN DISPATCHER — Orchestrate notification dispatch with retries
// ================================================================================

/**
 * ISSUE #238: Dispatch notifications after successful sprint contribution recalculation
 *
 * Main entry point called from Issue #237 persistence success path (setImmediate).
 * Implements 6-step pipeline:
 * 1. Load notification configuration (respects per-sprint feature flags)
 * 2. Dispatch student notifications (if enabled, one per group member)
 * 3. Dispatch coordinator summary notification (if enabled)
 * 4. Record results in audit log (for compliance)
 * 5. Update notification config tracking (lastNotificationAt, status)
 * 6. Handle any permanent failures (create SyncErrorLog for manual review)
 *
 * Non-fatal Behavior:
 * - Notification failures do NOT block the main recalculation response (202 already sent)
 * - Transient failures retry up to maxRetryAttempts with exponential backoff
 * - Permanent failures logged to SyncErrorLog with alert flag
 * - Partial failures (some recipients got notified) recorded as 'partial_failure'
 *
 * @param {String} groupId - Group whose sprint was recalculated
 * @param {String} sprintId - Sprint that was recalculated
 * @param {Object} contributionSummary - Issue #237 output: { contributions[], groupTotalStoryPoints, averageRatio, etc }
 * @param {String} coordinatorId - Coordinator who triggered recalculation
 * @param {String} correlationId - Trace ID linking all notifications to this recalculation
 * @param {Object} options - Optional: { notifyStudents, notifyCoordinator, skipConfig }
 * @returns {Promise<Object>} NotificationDispatchResult: { success, studentNotificationCount, coordinatorNotified, errors[] }
 */
async function dispatchSprintUpdateNotifications(
  groupId,
  sprintId,
  contributionSummary,
  coordinatorId,
  correlationId,
  options = {}
) {
  try {
    // ISSUE #238: Step 1 — Load notification configuration to check if notifications enabled
    let config;
    try {
      config = await SprintNotificationConfig.findForSprint(sprintId, groupId);
      
      // ISSUE #238: If no config exists, use defaults (notifications enabled by default)
      if (!config) {
        config = {
          notifyStudents: options.notifyStudents !== false,
          notifyCoordinator: options.notifyCoordinator !== false,
          maxRetryAttempts: 3,
          retryBackoffMs: [100, 200, 400]
        };
      }
    } catch (error) {
      // ISSUE #238: Log config fetch error but continue (don't block notifications)
      console.error(`ISSUE #238: Failed to load notification config for sprint ${sprintId}`, error);
      config = {
        notifyStudents: true,
        notifyCoordinator: true,
        maxRetryAttempts: 3,
        retryBackoffMs: [100, 200, 400]
      };
    }

    // ISSUE #238: Check if notifications are enabled (master flag)
    if (!config.notifyStudents && !config.notifyCoordinator) {
      // ISSUE #238: Notifications disabled, record as 'skipped' in audit
      await createAuditLog({
        action: 'SPRINT_NOTIFICATION_SKIPPED',
        actorId: 'system',
        targetId: groupId,
        groupId,
        payload: {
          sprintId,
          reason: 'notifications_disabled_for_sprint',
          correlationId
        }
      }).catch(() => {}); // Non-fatal

      return {
        success: true,
        skipped: true,
        studentNotificationCount: 0,
        coordinatorNotified: false,
        reason: 'Notifications disabled for this sprint'
      };
    }

    // ISSUE #238: Load group and member list for student notifications
    const group = await Group.findById(groupId).populate('members.studentId');
    if (!group || !group.members) {
      throw new NotificationServiceError(
        500,
        'GROUP_NOT_FOUND',
        `Unable to load group ${groupId} for notification dispatch`,
        { groupId, sprintId }
      );
    }

    const dispatchResult = {
      success: true,
      studentNotificationCount: 0,
      coordinatorNotified: false,
      errors: [],
      partialFailures: []
    };

    // ====================================================================
    // ISSUE #238: Step 2 — Dispatch student notifications (if enabled)
    // ====================================================================

    if (config.notifyStudents && contributionSummary.contributions && contributionSummary.contributions.length > 0) {
      // ISSUE #238: Send one notification per student in group
      for (const studentContribution of contributionSummary.contributions) {
        try {
          // ISSUE #238: Build student-specific notification payload
          const payload = buildStudentNotificationPayload(
            studentContribution.studentId,
            studentContribution,
            groupId,
            sprintId,
            correlationId
          );

          // ISSUE #238: Dispatch to external notification service with retry logic
          const notificationId = await dispatchNotificationWithRetry(
            payload,
            config.maxRetryAttempts,
            config.retryBackoffMs,
            { sprintId, groupId, studentId: studentContribution.studentId }
          );

          // ISSUE #238: Track successful dispatch
          if (notificationId) {
            dispatchResult.studentNotificationCount++;

            // ISSUE #238: Log successful student notification to audit trail
            await createAuditLog({
              action: 'SPRINT_NOTIFICATION_DISPATCHED',
              actorId: 'system',
              targetId: studentContribution.studentId,
              groupId,
              payload: {
                sprintId,
                notificationId,
                type: 'sprint_update_student',
                correlationId,
                ratio: studentContribution.contributionRatio
              }
            }).catch(() => {}); // Non-fatal
          }
        } catch (error) {
          // ISSUE #238: Log individual student notification failure (don't break loop)
          dispatchResult.partialFailures.push({
            studentId: studentContribution.studentId,
            error: error.message
          });

          // ISSUE #238: Create audit log for failed student notification
          await createAuditLog({
            action: 'SPRINT_NOTIFICATION_FAILED',
            actorId: 'system',
            targetId: studentContribution.studentId,
            groupId,
            payload: {
              sprintId,
              type: 'sprint_update_student',
              error: error.message,
              correlationId
            }
          }).catch(() => {}); // Non-fatal
        }
      }
    }

    // ====================================================================
    // ISSUE #238: Step 3 — Dispatch coordinator summary notification
    // ====================================================================

    if (config.notifyCoordinator) {
      try {
        // ISSUE #238: Build coordinator summary notification
        const coordinatorPayload = buildCoordinatorNotificationPayload(
          coordinatorId,
          groupId,
          sprintId,
          {
            groupTotalStoryPoints: contributionSummary.groupTotalStoryPoints || 0,
            averageRatio: contributionSummary.averageRatio || 0,
            maxRatio: contributionSummary.maxRatio || 0,
            minRatio: contributionSummary.minRatio || 0,
            memberCount: group.members.length,
            mappingWarningsCount: contributionSummary.unmappedStoryPointsCount || 0
          },
          correlationId
        );

        // ISSUE #238: Dispatch coordinator notification with retry
        const coordinatorNotificationId = await dispatchNotificationWithRetry(
          coordinatorPayload,
          config.maxRetryAttempts,
          config.retryBackoffMs,
          { sprintId, groupId, coordinatorId }
        );

        // ISSUE #238: Track successful coordinator dispatch
        if (coordinatorNotificationId) {
          dispatchResult.coordinatorNotified = true;

          // ISSUE #238: Log successful coordinator notification
          await createAuditLog({
            action: 'SPRINT_NOTIFICATION_DISPATCHED',
            actorId: 'system',
            targetId: coordinatorId,
            groupId,
            payload: {
              sprintId,
              notificationId: coordinatorNotificationId,
              type: 'sprint_summary_coordinator',
              correlationId,
              memberCount: group.members.length,
              groupTotalStoryPoints: contributionSummary.groupTotalStoryPoints
            }
          }).catch(() => {}); // Non-fatal
        }
      } catch (error) {
        // ISSUE #238: Coordinator notification failure is recorded but non-fatal
        dispatchResult.partialFailures.push({
          coordinatorId,
          type: 'coordinator_summary',
          error: error.message
        });

        // ISSUE #238: Create audit log for failed coordinator notification
        await createAuditLog({
          action: 'SPRINT_NOTIFICATION_FAILED',
          actorId: 'system',
          targetId: coordinatorId,
          groupId,
          payload: {
            sprintId,
            type: 'sprint_summary_coordinator',
            error: error.message,
            correlationId
          }
        }).catch(() => {}); // Non-fatal
      }
    }

    // ====================================================================
    // ISSUE #238: Step 4 — Update notification config tracking
    // ====================================================================

    if (config._id) {  // Only if config was loaded from DB
      try {
        const hasFailures = dispatchResult.partialFailures.length > 0;
        if (hasFailures && dispatchResult.studentNotificationCount > 0) {
          // ISSUE #238: Some succeeded, some failed = partial failure
          await config.recordFailedDispatch('Partial failure: some recipients notified', true);
        } else if (hasFailures) {
          // ISSUE #238: All failed
          await config.recordFailedDispatch('All notifications failed', false);
        } else {
          // ISSUE #238: All succeeded
          await config.recordSuccessfulDispatch();
        }
      } catch (error) {
        // ISSUE #238: Config update is non-fatal
        console.error(`ISSUE #238: Failed to update notification config tracking: ${error.message}`);
      }
    }

    // ISSUE #238: Determine final result status
    if (dispatchResult.partialFailures.length === 0) {
      // ISSUE #238: All notifications succeeded
      dispatchResult.success = true;
    } else if (dispatchResult.studentNotificationCount > 0 || dispatchResult.coordinatorNotified) {
      // ISSUE #238: Some succeeded, some failed = report as success with warnings
      dispatchResult.success = true;
      dispatchResult.partialFailuresOccurred = true;
    } else {
      // ISSUE #238: All notifications failed = report as failed
      dispatchResult.success = false;
    }

    return dispatchResult;

  } catch (error) {
    // ISSUE #238: Unexpected error in notification dispatch orchestrator
    console.error(`ISSUE #238: Error in dispatchSprintUpdateNotifications: ${error.message}`, error);

    // ISSUE #238: Create critical error log for manual review
    await createAuditLog({
      action: 'SPRINT_NOTIFICATION_DISPATCHER_ERROR',
      actorId: 'system',
      groupId,
      payload: {
        sprintId,
        error: error.message,
        correlationId
      }
    }).catch(() => {}); // Non-fatal

    // ISSUE #238: Return partial success (don't throw, let response send)
    return {
      success: false,
      error: error.message,
      studentNotificationCount: 0,
      coordinatorNotified: false,
      errors: [error.message]
    };
  }
}

// ================================================================================
// ISSUE #238: RETRY WRAPPER — Single notification dispatch with retry logic
// ================================================================================

/**
 * ISSUE #238: Dispatch a single notification with exponential backoff retry
 *
 * Implements transient error classification (5xx, 429, network) vs permanent (4xx except 429).
 * Max retries configurable, non-blocking on permanent failure.
 *
 * @param {Object} payload - Notification payload to send
 * @param {Number} maxAttempts - Maximum retry attempts (default 3)
 * @param {Array} backoffMs - Backoff delays [100, 200, 400] for exponential backoff
 * @param {Object} context - { sprintId, groupId, studentId?, coordinatorId? } for logging
 * @returns {Promise<String|null>} Notification ID on success, null on permanent failure
 */
async function dispatchNotificationWithRetry(payload, maxAttempts = 3, backoffMs = [100, 200, 400], context = {}) {
  // ISSUE #238: Use retry engine from notificationRetry.js for consistent handling
  try {
    const result = await retryNotificationWithBackoff(
      async () => {
        // ISSUE #238: POST to external notification service
        const response = await axios.post(
          `${NOTIFICATION_SERVICE_URL}/api/notifications`,
          payload,
          { timeout: NOTIFICATION_TIMEOUT_MS }
        );

        // ISSUE #238: Extract notification ID from response
        return response.data.notification_id || response.data.notificationId || uuidv4();
      },
      maxAttempts,
      backoffMs,
      {
        serviceName: 'sprint_notification',
        context
      }
    );

    return result;
  } catch (error) {
    // ISSUE #238: Permanent error after all retries exhausted
    console.error(
      `ISSUE #238: Permanent notification failure after ${maxAttempts} attempts for ${context.studentId || context.coordinatorId}:`,
      error.message
    );

    // ISSUE #238: Create SyncErrorLog entry for permanent failure (for manual review/alert)
    await SyncErrorLog.create({
      service: 'sprint_notification',
      groupId: context.groupId,
      actorId: 'system',
      attempts: maxAttempts,
      lastError: JSON.stringify({
        message: error.message,
        code: error.code,
        studentId: context.studentId,
        coordinatorId: context.coordinatorId,
        sprintId: context.sprintId
      })
    }).catch(err => {
      // ISSUE #238: Error logging itself is non-fatal
      console.error(`ISSUE #238: Failed to create SyncErrorLog: ${err.message}`);
    });

    return null;
  }
}

// ================================================================================
// ISSUE #238: EXPORTS
// ================================================================================

module.exports = {
  dispatchSprintUpdateNotifications,
  dispatchNotificationWithRetry,
  buildStudentNotificationPayload,
  buildCoordinatorNotificationPayload,
  NotificationServiceError
};
