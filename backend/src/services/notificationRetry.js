const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Determines if an error is transient (should retry) or permanent (should fail fast).
 * 
 * Transient errors: 5xx, 429 (rate limit), network timeouts
 * Permanent errors: 4xx (except 429), invalid input, bad configuration
 * 
 * @param {Error|object} error - The error to classify
 * @returns {boolean} true if transient (retry), false if permanent (fail fast)
 */
const isTransientError = (error) => {
  // Network-level errors are transient
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status code errors
  if (error.response) {
    const status = error.response.status;
    // 5xx errors are transient (server issue)
    if (status >= 500) {
      return true;
    }
    // 429 (rate limit) is transient
    if (status === 429) {
      return true;
    }
    // All other 4xx errors are permanent (client issue)
    return false;
  }

  // Timeout errors are transient
  if (error.message?.includes('timeout')) {
    return true;
  }

  // Default: treat unknown errors as permanent to fail fast
  return false;
};

/**
 * Retries a notification dispatch function with exponential backoff.
 * 
 * Retry strategy:
 * - Up to 3 attempts
 * - 100ms → 200ms → 400ms delays between attempts
 * - Only retries on transient errors (5xx, 429, network issues)
 * - Creates SyncErrorLog entry on permanent failure or exhaustion
 * 
 * @param {Function} dispatchFn - Async function to call (must return {success, notificationId, error})
 * @param {object} options
 * @param {object} options.context - Error context {groupId, operation, committeeId, etc.}
 * @param {number} options.maxAttempts - Max retry attempts (default: 3)
 * @returns {Promise<object>} { success: boolean, notificationId: string|null, error: object|null }
 */
const retryNotificationWithBackoff = async (dispatchFn, options = {}) => {
  const { context = {}, maxAttempts = 3 } = options;
  const backoffDelays = [100, 200, 400]; // milliseconds

  let lastError = null;
  let attempt = 0;

  for (attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await dispatchFn();

      // Success case
      if (result.success) {
        return {
          success: true,
          notificationId: result.notificationId,
          error: null,
        };
      }

      // Dispatch failed; store as lastError for potential retry
      lastError = result.error;

      // Check if error is transient
      if (!isTransientError(lastError)) {
        // Permanent error; fail immediately
        await SyncErrorLog.create({
          service: 'notification_service',
          groupId: context.groupId,
          committeeId: context.committeeId,
          actorId: context.actorId,
          operation: context.operation || 'notification_dispatch',
          status: 'failed',
          attempts: attempt + 1,
          lastError: {
            message: lastError.message || String(lastError),
            code: lastError.code || 'UNKNOWN',
            type: 'permanent',
          },
        });

        return {
          success: false,
          notificationId: null,
          error: lastError,
        };
      }

      // Transient error; continue to next attempt if available
      if (attempt < maxAttempts - 1) {
        const delayMs = backoffDelays[attempt];
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      lastError = err;

      // Check if caught error is transient
      if (!isTransientError(err)) {
        // Permanent error; fail immediately
        await SyncErrorLog.create({
          service: 'notification_service',
          groupId: context.groupId,
          committeeId: context.committeeId,
          actorId: context.actorId,
          operation: context.operation || 'notification_dispatch',
          status: 'failed',
          attempts: attempt + 1,
          lastError: {
            message: err.message || String(err),
            code: err.code || 'UNKNOWN',
            type: 'permanent',
          },
        });

        return {
          success: false,
          notificationId: null,
          error: err,
        };
      }

      // Transient error; continue to next attempt if available
      if (attempt < maxAttempts - 1) {
        const delayMs = backoffDelays[attempt];
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // Exhausted all retry attempts
  await SyncErrorLog.create({
    service: 'notification_service',
    groupId: context.groupId,
    committeeId: context.committeeId,
    actorId: context.actorId,
    operation: context.operation || 'notification_dispatch',
    status: 'failed',
    attempts: maxAttempts,
    lastError: {
      message: lastError?.message || 'Max retries exhausted',
      code: lastError?.code || 'MAX_RETRIES_EXCEEDED',
      type: 'transient_exhausted',
    },
  });

  return {
    success: false,
    notificationId: null,
    error: lastError,
  };
};

module.exports = {
  isTransientError,
  retryNotificationWithBackoff,
};
