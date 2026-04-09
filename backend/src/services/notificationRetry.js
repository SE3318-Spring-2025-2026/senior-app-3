const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * notificationRetry.js — Exponential backoff retry logic for Notification Service.
 *
 * Features:
 *   - Transient error classification (distinguish 5xx/429 from permanent 4xx failures)
 *   - Exponential backoff: 100ms → 200ms → 400ms
 *   - Max 3 attempts (configurable)
 *   - Automatic SyncErrorLog creation on final failure
 *   - Non-fatal error handling (caller decides whether to proceed)
 */

/**
 * isTransientError(error)
 *
 * Classifies error as transient (retry) or permanent (fail immediately).
 *   - TRANSIENT: 5xx server errors, 429 rate limit, network timeouts, ECONNREFUSED
 *   - PERMANENT: 4xx (except 429), invalid input, validation errors
 */
function isTransientError(error) {
  if (!error) return false;

  const status = error.response?.status || error.status;
  const message = error.message || '';

  // 5xx Server errors → transient
  if (status >= 500 && status < 600) return true;

  // 429 Rate Limit → transient
  if (status === 429) return true;

  // Network errors → transient
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) return true;
  if (message.includes('timeout') || message.includes('network')) return true;

  // 4xx (except 429) → permanent
  if (status >= 400 && status < 500) return false;

  // Default: assume transient for unknown errors
  return true;
}

/**
 * retryNotificationWithBackoff(dispatchFn, options)
 *
 * @param {Function} dispatchFn — Async function that dispatches notification (should return { notificationId })
 * @param {Object} options
 *   - maxAttempts: number (default: 3)
 *   - baseDelayMs: number (default: 100)
 *   - context: { userId, groupId, or other identifier for logging }
 *
 * @returns {Promise<{ success: bool, notificationId: string|null, error: Error|null }>}
 *   - success: true if dispatch succeeded
 *   - notificationId: ID from Notification Service if successful
 *   - error: The error object if all retries exhausted
 *
 * SIDE EFFECTS:
 *   - On final failure: creates SyncErrorLog entry with transient classification
 */
async function retryNotificationWithBackoff(dispatchFn, options = {}) {
  const { maxAttempts = 3, baseDelayMs = 100, context = {} } = options;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await dispatchFn();
      return {
        success: true,
        notificationId: result?.notificationId || result?.id || null,
        error: null,
      };
    } catch (error) {
      lastError = error;
      const isTransient = isTransientError(error);

      console.warn(
        `[Notification] Attempt ${attempt}/${maxAttempts} failed (${isTransient ? 'transient' : 'permanent'}):`,
        error.message
      );

      // Permanent error: fail immediately
      if (!isTransient) {
        return handlePermanentError(error, context);
      }

      // Transient error: retry if attempts remain
      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[Notification] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted
  console.error('[Notification] All retries exhausted');
  return handleTransientExhaustedError(lastError, context);
}

/**
 * Helper: Handle permanent error
 */
async function handlePermanentError(error, context) {
  console.error('[Notification] Permanent error, stopping retries:', error.message);

  try {
    await SyncErrorLog.create({
      service: 'NotificationService',
      operation: 'dispatch',
      status: 'failed',
      errorType: 'permanent',
      errorMessage: error.message,
      context,
      timestamp: new Date(),
    });
  } catch (logErr) {
    console.error('[Notification] Failed to create SyncErrorLog:', logErr.message);
  }

  return {
    success: false,
    notificationId: null,
    error,
  };
}

/**
 * Helper: Handle transient error exhaustion
 */
async function handleTransientExhaustedError(lastError, context) {
  try {
    await SyncErrorLog.create({
      service: 'NotificationService',
      operation: 'dispatch',
      status: 'failed',
      errorType: 'transient_exhausted',
      errorMessage: lastError?.message || 'Unknown error',
      context,
      timestamp: new Date(),
    });
  } catch (logErr) {
    console.error('[Notification] Failed to create SyncErrorLog:', logErr.message);
  }

  return {
    success: false,
    notificationId: null,
    error: lastError,
  };
}

module.exports = {
  retryNotificationWithBackoff,
  isTransientError,
};
