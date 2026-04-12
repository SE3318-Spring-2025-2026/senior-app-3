const { dispatchCommitteePublishedNotification } = require('./notificationService');
const { retryNotificationWithBackoff } = require('./notificationRetry');
const { createAuditLog } = require('./auditService');

/**
 * Issue #87: Build notification payload with recipient aggregation
 * 
 * Core Logic:
 * - Use Set to collect unique recipient IDs (automatic deduplication)
 * - Recipients = advisorIds + juryIds + groupMemberIds
 * - No duplicate notifications sent
 * 
 * Payload Structure:
 * {
 *   type: 'committee_published',
 *   committeeId: string (from D3),
 *   committeeName: string (from D3),
 *   publishedAt: timestamp (from D3),
 *   recipients: [userId1, userId2, ...] (deduplicated),
 *   recipientCount: number (total unique recipients)
 * }
 * 
 * Used by sendCommitteeNotification() before dispatch
 */
const buildCommitteeNotificationPayload = async (committee, groupMemberIds = []) => {
  /**
   * Issue #87: Recipient Aggregation with Deduplication
   * 
   * Set ensures no duplicate userIds across:
   * 1. advisorIds (Process 4.2 assignment)
   * 2. juryIds (Process 4.3 assignment)
   * 3. groupMemberIds (from Group.members array)
   * 
   * Example:
   * - advisorIds: [user1, user2]
   * - juryIds: [user2, user3]
   * - groupMemberIds: [user3, user4]
   * - Result: Set{user1, user2, user3, user4} → 4 unique recipients
   * - Without Set: 7 duplicate notifications would be sent
   */
  const recipients = new Set();

  // Add advisors (Process 4.2)
  if (committee.advisorIds && Array.isArray(committee.advisorIds)) {
    committee.advisorIds.forEach((id) => recipients.add(id));
  }

  // Add jury members (Process 4.3)
  if (committee.juryIds && Array.isArray(committee.juryIds)) {
    committee.juryIds.forEach((id) => recipients.add(id));
  }

  // Add group members (students who will submit deliverables)
  if (Array.isArray(groupMemberIds)) {
    groupMemberIds.forEach((id) => recipients.add(id));
  }

  return {
    type: 'committee_published',
    committeeId: committee.committeeId,
    committeeName: committee.committeeName,
    publishedAt: committee.publishedAt,
    recipients: Array.from(recipients),
    recipientCount: recipients.size,
  };
};

/**
 * Issue #87: Send committee notification with retry logic and error handling
 * 
 * This is the central orchestration function for Issue #87.
 * 
 * Workflow:
 * 1. Build notification payload with deduped recipients
 * 2. Dispatch to Notification Service with automatic retry
 * 3. Handle success: log audit event
 * 4. Handle failure: log error but don't throw (partial failure model)
 * 5. Return status flag for caller
 * 
 * Retry Strategy (Issue #87 Acceptance Criteria):
 * - Maximum 3 attempts (isTransientError decides if retry needed)
 * - Backoff delays: [100ms, 200ms, 400ms] (exponential pattern)
 * - Transient errors: network timeouts, 5xx responses, connection refused
 * - Non-transient errors: 403 Forbidden, 400 Bad Request (fail immediately)
 * 
 * Error Handling (Issue #87 Acceptance Criteria):
 * - Success: notificationTriggered = true
 * - Failure after retries: notificationTriggered = false
 * - All failures logged to audit trail with committeeId and error details
 * - Committee publish SUCCEEDS even if notification dispatch FAILS
 *   (This is "partial failure" - committee is published, notification retry can happen manually)
 * 
 * Audit Trail:
 * - Event: COMMITTEE_NOTIFICATION_SENT (success)
 * - Event: COMMITTEE_NOTIFICATION_FAILED (after retries exhausted)
 * - Always includes committeeId for traceability
 */
const sendCommitteeNotification = async (committee, publishedBy, groupMemberIds = []) => {
  try {
    console.log(`[Notification] Preparing committee notification for ${committee.committeeId}`);

    // Build payload with deduped recipients
    const payload = await buildCommitteeNotificationPayload(committee, groupMemberIds);
    console.log(`[Notification] Payload built with ${payload.recipients.length} recipients`);

    /**
     * Issue #87: Dispatch with Automatic Retry
     * 
     * retryNotificationWithBackoff() returns:
     * {
     *   success: boolean,
     *   notificationId: string (if successful),
     *   error: string (if failed),
     *   attempt: number (1-3)
     * }
     * 
     * Only used for transient errors (network issues, 5xx).
     * Non-transient errors (4xx except 429) fail immediately.
     */
    const result = await retryNotificationWithBackoff(
      () => dispatchCommitteePublishedNotification(payload, publishedBy),
      {
        maxRetries: 3,
        backoffMs: [100, 200, 400],
        context: {
          committeeId: payload.committeeId,
          groupId: 'SYSTEM',
          actorId: publishedBy,
        },
      }
    );

    if (result.success) {
      // Log successful notification
      await createAuditLog({
        event: 'COMMITTEE_NOTIFICATION_SENT',
        userId: publishedBy,
        entityType: 'Notification',
        entityId: result.notificationId,
        changes: {
          committeeId: committee.committeeId,
          recipientCount: payload.recipients.length,
          type: 'committee_published',
        },
      });

      console.log(`[Notification] Committee ${committee.committeeId} notification sent successfully`);
      return {
        success: true,
        notificationId: result.notificationId,
        recipientCount: payload.recipients.length,
      };
    } else {
      const err = result.error;
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : err?.message || 'Notification dispatch failed after 3 retries';
      throw new Error(msg);
    }
  } catch (error) {
    console.error('[Notification] Committee notification failed:', {
      committeeId: committee.committeeId,
      error: error.message,
    });

    /**
     * Issue #87: Failure Logging (Acceptance Criteria)
     * 
     * Even on failure, log to audit trail for:
     * 1. Debugging/support team to see what went wrong
     * 2. Manual retry capability
     * 3. Compliance/audit trail completeness
     * 
     * Logged info:
     * - Event: COMMITTEE_NOTIFICATION_FAILED
     * - committeeId: for traceability
     * - error message: specific reason for failure
     * - userId: who triggered (publishedBy)
     */
    try {
      await createAuditLog({
        event: 'COMMITTEE_NOTIFICATION_FAILED',
        userId: publishedBy,
        entityType: 'Notification',
        entityId: committee.committeeId,
        changes: {
          committeeId: committee.committeeId,
          type: 'committee_published',
          error: error.message,
        },
      });
    } catch (logError) {
      console.error('[Notification] Failed to log notification error:', logError.message);
    }

    /**
     * Issue #87: Partial Failure Model
     * 
     * Return failure flag but do NOT throw exception.
     * This allows:
     * 1. Committee to remain published (transaction doesn't roll back)
     * 2. Coordinator to see notificationTriggered: false in response
     * 3. Manual retry of notification later if needed
     * 
     * Alternative would be to fail entire publish, which is worse UX
     * (coordinator can't publish committee if notification service is down).
     */
    return {
      success: false,
      notificationId: null,
      error: error.message,
      recipientCount: 0,
    };
  }
};

module.exports = {
  buildCommitteeNotificationPayload,
  sendCommitteeNotification,
};

