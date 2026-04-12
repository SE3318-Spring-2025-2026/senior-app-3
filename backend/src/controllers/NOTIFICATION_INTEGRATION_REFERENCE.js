/**
 * REFERENCE IMPLEMENTATION FOR ISSUE #69
 * This file demonstrates how to properly integrate the Notification Service
 * for advisor association events with the new retry utility and notificationTriggered flag.
 *
 * This is a template showing best practices for controllers that dispatch
 * advisor-related notifications (advisee_request and disband_notice types).
 */

const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
const { dispatchAdvisorRequestNotification } = require('../services/notificationService');
const Group = require('../models/Group');
const { createAuditLog } = require('../utils/auditLogger');

/**
 * EXAMPLE 1: Dispatching Advisee Request Notification (Issue #62)
 *
 * Demonstrates how to properly use retryNotificationWithBackoff() when creating
 * an advisor request. This is called after request validation and D2 write.
 */
const exampleAdviseeRequestNotification = async (req, res, group, advisorRequest) => {
  const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
  const { dispatchAdvisorRequestNotification } = require('../services/notificationService');

  // Use retry utility with transient error classification
  const notificationResult = await retryNotificationWithBackoff(
    () =>
      dispatchAdvisorRequestNotification({
        groupId: group.groupId,
        groupName: group.groupName,
        professorId: advisorRequest.professorId,
        requesterId: advisorRequest.requestedBy,
        message: advisorRequest.message,
      }),
    {
      maxAttempts: 3,
      initialBackoffMs: 100,
      identifier: advisorRequest.requestId,
      identifierType: 'requestId',
    }
  );

  // Update D2 with notificationTriggered flag based on result
  const notificationTriggered = notificationResult.success;

  // Update the advisorRequest in MongoDB
  group.advisorRequest.notificationTriggered = notificationTriggered;
  await group.save();

  // Create audit log for successful dispatch (or note the failure)
  await createAuditLog({
    action: 'advisor_request_notification_dispatched',
    actorId: req.user.userId,
    targetId: group.groupId,
    groupId: group.groupId,
    payload: {
      request_id: advisorRequest.requestId,
      professor_id: advisorRequest.professorId,
      notification_triggered: notificationTriggered,
      error: notificationResult.error?.message || null,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Return response with notificationTriggered field
  return {
    requestId: advisorRequest.requestId,
    groupId: group.groupId,
    professorId: advisorRequest.professorId,
    requesterId: advisorRequest.requestedBy,
    status: advisorRequest.status,
    message: advisorRequest.message,
    notificationTriggered, // ← IMPORTANT: Include in response per OpenAPI spec
    createdAt: advisorRequest.createdAt.toISOString(),
  };
};

/**
 * EXAMPLE 2: Dispatching Group Disband Notification (Issue #67)
 *
 * Demonstrates how to use retryNotificationWithBackoff() when disbanding a group.
 * This includes proper error handling for individual group disbands in a batch operation.
 */
const exampleDisbandNotification = async (group) => {
  const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
  const { dispatchDisbandNotification } = require('../services/notificationService');

  // Filter for accepted members to notify
  const recipients = group.members
    .filter((m) => m.status === 'accepted')
    .map((m) => m.userId);

  if (recipients.length === 0) {
    return { notificationTriggered: false };
  }

  // Use retry utility with transient error classification
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
      initialBackoffMs: 100,
      identifier: group.groupId,
      identifierType: 'groupId',
    }
  );

  return {
    notificationTriggered: notificationResult.success,
    error: notificationResult.error,
  };
};

/**
 * KEY PRINCIPLES FOR ISSUE #69 COMPLIANCE:
 *
 * 1. TRANSIENT ERROR CLASSIFICATION
 *    - Use retryNotificationWithBackoff() instead of manual retry loops
 *    - It automatically classifies errors as transient (5xx, 429, network) or permanent (4xx)
 *    - Permanent errors fail immediately without retrying
 *    - Transient errors retry up to 3 times with exponential backoff
 *
 * 2. EXPONENTIAL BACKOFF
 *    - Default: 100ms → 200ms → 400ms between retries
 *    - Configurable via initialBackoffMs parameter
 *    - Reduces load on Notification Service during transient failures
 *
 * 3. NOTIFICATION TRIGGERED FLAG
 *    - Always include in API responses (per OpenAPI spec)
 *    - Set to true only on successful dispatch
 *    - Update D2 Group model when persisting request
 *    - Return in JSON response to caller
 *
 * 4. ERROR LOGGING
 *    - Use SyncErrorLog automatically created by retryNotificationWithBackoff()
 *    - Also create audit logs for successful dispatches
 *    - Include identifier (requestId/groupId) for troubleshooting
 *
 * 5. PAYLOAD CONSTRUCTION
 *    - For advisee_request: recipient = professorId (single professor)
 *    - For disband_notice: recipients = [group members] (array of students)
 *    - Both use standardized payload format via service functions
 *
 * 6. CODE REUSABILITY (DRY)
 *    - Never repeat the retry loop in multiple controllers
 *    - Always use retryNotificationWithBackoff() from utils/notificationRetry.js
 *    - All notification dispatch calls use functions from notificationService.js
 */

module.exports = {
  exampleAdviseeRequestNotification,
  exampleDisbandNotification,
};
