/**
 * Issue #87: Notification Retry Service with Exponential Backoff
 * 
 * Purpose:
 * Implement resilient retry logic for Notification Service dispatch.
 * Handles transient vs permanent errors, retry classification, and logging.
 * 
 * Used By:
 * - committeeNotificationService.sendCommitteeNotification()
 * - dispatchCommitteePublishedNotification() dispatch attempt
 * 
 * DFD Context:
 * - Flow f09: 4.5 → Notification Service (committee publish notifications)
 * - Ensures notifications eventually reach recipients despite temporary network issues
 * 
 * Retry Strategy:
 * - Maximum 3 attempts
 * - Backoff delays: [100ms, 200ms, 400ms] between attempts
 * - Only retries on transient errors (5xx, 429, network timeouts)
 * - Fails immediately on permanent errors (4xx except 429)
 * 
 * Error Classification:
 * ┌─────────────────────────────────────────────┐
 * │ Transient (Retry)    │ Permanent (Fail Fast) │
 * ├─────────────────────────────────────────────┤
 * │ HTTP 5xx             │ HTTP 4xx (except 429) │
 * │ HTTP 429 (rate limit)│ Invalid input         │
 * │ ECONNREFUSED         │ Authentication error  │
 * │ ETIMEDOUT            │ Bad configuration     │
 * │ ENOTFOUND            │                       │
 * │ Socket timeout       │                       │
 * └─────────────────────────────────────────────┘
 */

const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Issue #87: Classify error as transient (should retry) or permanent (fail fast)
 * 
 * @param {Error|object} error - Error to classify
 * @returns {boolean} - true if transient (retry), false if permanent (fail fast)
 */
const isTransientError = (error) => {
  // Network-level transient errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status code errors
  if (error.response) {
    const status = error.response.status;
    
    // 5xx errors are transient (server issue, likely temporary)
    if (status >= 500) {
      return true;
    }
    
    // 429 (rate limit) is transient (should retry after backoff)
    if (status === 429) {
      return true;
    }
    
    // All other 4xx errors are permanent (client issue, won't be fixed by retry)
    return false;
  }

  // Timeout errors are transient
  if (error.message?.includes('timeout')) {
    return true;
  }

  // Unknown errors treated as permanent to fail fast
  return false;
};

/**
 * Issue #87: Log and store permanent error to audit trail
 */
const logPermanentError = async (error, attempt, context) => {
  try {
    await SyncErrorLog.create({
      service: 'notification_service',
      context: context.committeeId || 'unknown',
      operation: 'committee_published',
      status: 'failed',
      attempts: attempt,
      lastError: {
        message: error.message,
        code: error.code || 'PERMANENT_ERROR',
        type: 'permanent',
      },
    });
  } catch (logErr) {
    console.error('[Notification] Failed to log permanent error:', logErr.message);
  }
};

/**
 * Issue #87: Log and store exhausted retries to audit trail
 */
const logExhaustedRetries = async (error, maxRetries, context) => {
  try {
    await SyncErrorLog.create({
      service: 'notification_service',
      context: context.committeeId || 'unknown',
      operation: 'committee_published',
      status: 'failed',
      attempts: maxRetries,
      lastError: {
        message: error?.message || 'Max retries exhausted',
        code: error?.code || 'MAX_RETRIES_EXCEEDED',
        type: 'transient_exhausted',
      },
    });
  } catch (logErr) {
    console.error('[Notification] Failed to log max retries error:', logErr.message);
  }
};

/**
 * Issue #87: Retry dispatch function with exponential backoff
 * 
 * Core Algorithm:
 * ```
 * for attempt = 0 to maxRetries-1:
 *   try dispatchFn()
 *   if success: return { success: true, ... }
 *   if error is permanent: return { success: false, error, ... }
 *   if error is transient:
 *     if more attempts available: sleep(backoffMs[attempt])
 *     else: return { success: false, error, ... }
 * ```
 * 
 * Exponential Backoff:
 * - Attempt 1 fails → wait 100ms before attempt 2
 * - Attempt 2 fails → wait 200ms before attempt 3
 * - Attempt 3 fails → give up, log error
 * 
 * Total maximum wait time: 100 + 200 = 300ms (less than HTTP timeout)
 * 
 * @param {Function} dispatchFn - Async function to retry (must return {success, result})
 * @param {object} options
 * @param {number} options.maxRetries - Max attempts (default: 3)
 * @param {number[]} options.backoffMs - Backoff delays in milliseconds (default: [100, 200, 400])
 * @param {object} options.context - Error context for audit logging {committeeId, publishedBy, etc.}
 * 
 * @returns {Promise<object>} { success, result, error, attempt }
 */
const retryNotificationWithBackoff = async (
  dispatchFn,
  options = {}
) => {
  const {
    maxRetries = 3,
    backoffMs = [100, 200, 400],
    context = {},
  } = options;

  let lastError = null;
  let attempt = 0;

  /**
   * Issue #87: Retry Loop
   * 
   * Attempts dispatch up to maxRetries times.
   * On each failure, evaluates error type to decide if retry is worthwhile.
   */
  for (attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      console.log(
        `[Notification] Dispatch attempt ${attempt + 1}/${maxRetries} for committeeId: ${context.committeeId}`
      );

      // Call the dispatch function
      const result = await dispatchFn();

      // Success case
      if (result?.success) {
        console.log(
          `[Notification] SUCCESS on attempt ${attempt + 1}: ${result.notificationId}`
        );
        return {
          success: true,
          result: result,
          error: null,
          attempt: attempt + 1,
        };
      }

      // Dispatch returned error object
      lastError = result?.error || new Error('Dispatch returned failure');
      console.log(
        `[Notification] Dispatch returned failure: ${lastError.message}`
      );

      // Check if error is permanent
      if (!isTransientError(lastError)) {
        console.log(`[Notification] Permanent error (no retry): ${lastError.message}`);
        await logPermanentError(lastError, attempt + 1, context);
        return {
          success: false,
          result: null,
          error: lastError,
          attempt: attempt + 1,
        };
      }

      /**
       * Issue #87: Transient Error Retry Logic
       * 
       * Error is transient (network issue, server temporary unavailable, etc).
       * If more attempts available, sleep with backoff before retrying.
       */
      if (attempt < maxRetries - 1) {
        const delayMs = backoffMs[attempt] || 400;
        console.log(
          `[Notification] Transient error, retrying after ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      lastError = err;
      console.log(`[Notification] Exception caught: ${err.message}`);

      if (!isTransientError(err)) {
        console.log(`[Notification] Permanent exception (no retry): ${err.message}`);
        await logPermanentError(err, attempt + 1, context);
        return {
          success: false,
          result: null,
          error: err,
          attempt: attempt + 1,
        };
      }
    }
  }

  /**
   * Issue #87: All Retries Exhausted
   * 
   * Reached maximum attempts. All attempts failed (transient errors).
   * Log failure to SyncErrorLog for manual follow-up if needed.
   */
  console.log(
    `[Notification] All ${maxRetries} attempts exhausted for committeeId: ${context.committeeId}`
  );

  try {
    await SyncErrorLog.create({
      service: 'notification_service',
      context: context.committeeId || 'unknown',
      operation: 'committee_published',
      status: 'failed',
      attempts: maxRetries,
      lastError: {
        message: lastError?.message || 'Max retries exhausted',
        code: lastError?.code || 'MAX_RETRIES_EXCEEDED',
        type: 'transient_exhausted',
      },
    });
  } catch (logErr) {
    console.error('[Notification] Failed to log max retries error:', logErr.message);
  }

  return {
    success: false,
    result: null,
    error: lastError || new Error('Max retries exhausted'),
    attempt: maxRetries,
  };
};

module.exports = {
  isTransientError,
  retryNotificationWithBackoff,
};
