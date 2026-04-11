const { dispatchAdviseeRequestNotification } = require('./notificationService');
const { retryNotificationWithBackoff } = require('./notificationRetry');
const { createAuditLog } = require('./auditService');

/**
 * Issue #61 Fix #4: Advisee Request Notification Service
 * 
 * Implements Process 3.3 + Flow f05 notification dispatch
 * 
 * PR Review Issue #4: Process 3.3 Notification Dispatch is Missing
 * - Original: No notification logic implemented
 * - Fixed: Async fire-and-forget pattern with error logging
 * 
 * Workflow:
 * 1. Build notification payload
 * 2. Dispatch to Notification Service with retry logic (3 attempts)
 * 3. Return success/failure flag
 * 4. Log all failures to audit trail
 * 5. Do NOT block API response on failure (partial failure model)
 * 
 * References:
 * - DFD Flow f05: 3.3 → Notification Service
 * - Process: 3.3 (Notify Advisor)
 */

/**
 * Build advisee request notification payload
 * 
 * Payload structure for type: 'advisee_request'
 * {
 *   type: 'advisee_request',
 *   requestId: string (unique request ID),
 *   groupId: string (requesting group),
 *   professorId: string (recipient - professor being requested),
 *   requesterId: string (team leader who made the request),
 *   message: string (optional message from team leader)
 * }
 * 
 * This is dispatched to Notification Service for professor delivery
 */
const buildAdviseeRequestPayload = (requestData) => {
  return {
    type: 'advisee_request',
    requestId: requestData.requestId,
    groupId: requestData.groupId,
    professorId: requestData.professorId, // Professor is recipient
    requesterId: requestData.requesterId,
    message: requestData.message || '',
  };
};

/**
 * Send advisee request notification with retry logic
 * 
 * Issue #61 Fix #4: Process 3.3 Notification Integration
 * 
 * Dispatch Logic:
 * - Flow f05: 3.3 → Notification Service
 * - Retry: 3 attempts with [100ms, 200ms, 400ms] exponential backoff
 * - Failure handling: Log but don't block response (partial failure model)
 * 
 * Returns: { success, notificationId, error }
 * - success: true = notification queued successfully
 * - success: false = notification failed after 3 retries (logged to audit trail)
 * 
 * Note: Function should NEVER throw exception, only return failure object
 * This allows the API response to succeed even if notification fails
 */
const sendAdviseeRequestNotification = async (requestData, requesterId) => {
  try {
    console.log(`[Notification] Preparing advisee request notification for ${requestData.requestId}`);

    const payload = buildAdviseeRequestPayload(requestData);

    // Dispatch with retry logic
    // Issue #61 Accept Criteria: "Transient failures trigger up to 3 retries"
    // Backoff: [100ms, 200ms, 400ms] as per spec
    const result = await retryNotificationWithBackoff(
      () => dispatchAdviseeRequestNotification(payload),
      {
        maxRetries: 3,
        backoffMs: [100, 200, 400],
      }
    );

    if (result.success) {
      // Log successful notification (Issue #61: no silent successes either)
      await createAuditLog({
        event: 'ADVISEE_REQUEST_NOTIFICATION_SENT',
        userId: requesterId,
        entityType: 'AdvisorRequest',
        entityId: requestData.requestId,
        changes: {
          requestId: requestData.requestId,
          professorId: requestData.professorId,
          type: 'advisee_request',
          notificationId: result.notificationId,
        },
      });

      console.log(`[Notification] Advisee request notification sent for ${requestData.requestId}`);
      return {
        success: true,
        notificationId: result.notificationId,
      };
    } else {
      throw new Error(result.error || 'Notification dispatch failed after 3 retries');
    }
  } catch (error) {
    console.error('[Notification] Advisee request notification failed:', {
      requestId: requestData.requestId,
      error: error.message,
    });

    /**
     * Issue #61: Notification Service delivery failures must be logged
     * PR Review Issue #4: "Delivery failure: error logged and surfaced — no silent failures"
     * 
     * Log failures to audit trail with full context
     */
    try {
      await createAuditLog({
        event: 'ADVISEE_REQUEST_NOTIFICATION_FAILED',
        userId: requesterId,
        entityType: 'AdvisorRequest',
        entityId: requestData.requestId,
        changes: {
          requestId: requestData.requestId,
          professorId: requestData.professorId,
          type: 'advisee_request',
          error: error.message,
          timestamp: new Date(),
        },
      });
    } catch (logError) {
      console.error('[Notification] Failed to log notification error:', logError.message);
    }

    /**
     * Issue #61 Accept Criteria: "Notification Service delivery failure is logged"
     * But MUST NOT block the API response
     * Return failure flag, do NOT throw exception
     */
    return {
      success: false,
      notificationId: null,
      error: error.message,
    };
  }
};

module.exports = {
  buildAdviseeRequestPayload,
  sendAdviseeRequestNotification,
};
