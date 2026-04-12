const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Persist a failed notification sync using the SyncErrorLog schema (best-effort).
 */
const logSyncFailure = async (context, attempts, lastError) => {
  const msg =
    typeof lastError === 'string'
      ? lastError
      : lastError?.message || String(lastError || 'Unknown error');
  try {
    await SyncErrorLog.create({
      service: 'notification',
      groupId: context.groupId || context.committeeId || 'notification-sync',
      actorId: context.actorId || 'system',
      attempts,
      lastError: msg,
    });
  } catch (e) {
    console.error('[notificationRetry] SyncErrorLog create failed:', e.message);
  }
};

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
  if (!error) return false;

  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  if (!error.response) {
    return true;
  }

  const status = error.response.status;
  if (status >= 500) return true;
  if (status === 429) return true;
  return false;
};

/**
 * Retries a notification dispatch function with exponential backoff.
 *
 * @param {Function} dispatchFn - Async function to call (must return {success, notificationId, error})
 * @param {object} options
 * @param {object} options.context - Error context {groupId, operation, committeeId, actorId}
 * @param {number} options.maxAttempts - Max retry attempts (default: 3)
 * @returns {Promise<object>} { success: boolean, notificationId: string|null, error: object|null }
 */
const retryNotificationWithBackoff = async (dispatchFn, options = {}) => {
  const { context = {}, maxAttempts = 3 } = options;
  const backoffDelays = [100, 200, 400];

  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await dispatchFn();

      if (result.success) {
        return {
          success: true,
          notificationId: result.notificationId,
          error: null,
        };
      }

      lastError = result.error;

      if (!isTransientError(lastError)) {
        await logSyncFailure(context, attempt + 1, lastError);
        return {
          success: false,
          notificationId: null,
          error: lastError,
        };
      }

      if (attempt < maxAttempts - 1) {
        const delayMs = backoffDelays[attempt];
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      lastError = err;

      if (!isTransientError(err)) {
        await logSyncFailure(context, attempt + 1, err);
        return {
          success: false,
          notificationId: null,
          error: err,
        };
      }

      if (attempt < maxAttempts - 1) {
        const delayMs = backoffDelays[attempt];
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  await logSyncFailure(context, maxAttempts, lastError);

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
