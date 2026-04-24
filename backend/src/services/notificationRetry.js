/**
 * Notification retry service — exponential backoff for Notification Service calls.
 * Used by committee notifications and dispatchCommitteePublishNotification.
 */

const SyncErrorLog = require('../models/SyncErrorLog');
const { logError, logInfo, logWarn } = require('../utils/structuredLogger');

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

  if (error.response) {
    const status = error.response.status;
    if (status >= 500) {
      return true;
    }
    if (status === 429) {
      return true;
    }
    return false;
  }

  if (error.message?.includes('timeout')) {
    return true;
  }

  return false;
};

const isDispatchSuccess = (result) => result && result.success === true;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatLastErrorForDb = (error, extra = {}) => {
  const payload = {
    ...extra,
    message: error?.message || String(error),
    code: error?.code || undefined,
  };
  try {
    return JSON.stringify(payload);
  } catch {
    return String(error?.message || error);
  }
};

const createNotificationSyncErrorLog = async (error, attempts, context) => {
  const groupId = context.groupId || 'SYSTEM';
  const actorId = context.actorId != null ? String(context.actorId) : 'unknown';
  const committeeId = context.committeeId || 'unknown';

  await SyncErrorLog.create({
    service: 'notification',
    groupId,
    actorId,
    attempts,
    lastError: formatLastErrorForDb(error, { committeeId }),
  });
};

const logPermanentError = async (error, attempt, context) => {
  try {
    await createNotificationSyncErrorLog(error, attempt, context);
  } catch (logErr) {
    logError('Failed to log permanent notification error', {
      service_name: 'notification_dispatch',
      correlationId: context?.correlationId || null,
      externalRequestId: context?.externalRequestId || null,
      attempt,
      error: logErr.message
    });
  }
};

const logExhaustedRetries = async (error, maxRetries, context) => {
  try {
    await createNotificationSyncErrorLog(error, maxRetries, context);
  } catch (logErr) {
    logError('Failed to log notification max retries error', {
      service_name: 'notification_dispatch',
      correlationId: context?.correlationId || null,
      externalRequestId: context?.externalRequestId || null,
      attempt: maxRetries,
      error: logErr.message
    });
  }
};

/**
 * Retries a notification dispatch function with exponential backoff.
 *
 * @param {Function} dispatchFn - Async function to call (must return {success, notificationId, error})
 * @param {object} options
 * @param {object} options.context - Error context {groupId, committeeId, actorId}
 * @param {number} [options.maxRetries=3] - Max retry attempts
 * @param {number[]} [options.backoffMs=[100,200,400]] - Delay between attempts
 * @param {number} [options.maxAttempts] - Alias for maxRetries (backwards compatibility)
 * @returns {Promise<object>} { success: boolean, notificationId: string|null, error: object|null }
 */
const retryNotificationWithBackoff = async (dispatchFn, options = {}) => {
  const {
    maxRetries = 3,
    backoffMs = [100, 200, 400],
    context = {},
    maxAttempts,
  } = options;

  const limit = maxAttempts ?? maxRetries;

  let lastError = null;

  for (let attempt = 0; attempt < limit; attempt += 1) {
    try {
      logInfo('Notification dispatch attempt started', {
        service_name: 'notification_dispatch',
        correlationId: context?.correlationId || null,
        externalRequestId: context?.externalRequestId || null,
        attempt: attempt + 1,
        maxAttempts: limit,
        committeeId: context?.committeeId || null
      });

      const result = await dispatchFn();

      if (isDispatchSuccess(result)) {
        logInfo('Notification dispatch succeeded', {
          service_name: 'notification_dispatch',
          correlationId: context?.correlationId || null,
          externalRequestId: context?.externalRequestId || null,
          attempt: attempt + 1,
          notificationId: result.notificationId || null
        });
        return {
          success: true,
          notificationId: result.notificationId,
          result,
          error: null,
          attempt: attempt + 1,
        };
      }

      lastError = result?.error || new Error('Dispatch returned failure');
      logWarn('Notification dispatch returned failure', {
        service_name: 'notification_dispatch',
        correlationId: context?.correlationId || null,
        externalRequestId: context?.externalRequestId || null,
        attempt: attempt + 1,
        error: lastError.message
      });

      if (!isTransientError(lastError)) {
        logWarn('Notification permanent error encountered', {
          service_name: 'notification_dispatch',
          correlationId: context?.correlationId || null,
          externalRequestId: context?.externalRequestId || null,
          attempt: attempt + 1,
          error: lastError.message
        });
        await logPermanentError(lastError, attempt + 1, context);
        return {
          success: false,
          notificationId: null,
          result: null,
          error: lastError,
          attempt: attempt + 1,
        };
      }
    } catch (err) {
      lastError = err;
      logWarn('Notification dispatch threw exception', {
        service_name: 'notification_dispatch',
        correlationId: context?.correlationId || null,
        externalRequestId: context?.externalRequestId || null,
        attempt: attempt + 1,
        error: err.message
      });

      if (!isTransientError(err)) {
        logWarn('Notification permanent exception encountered', {
          service_name: 'notification_dispatch',
          correlationId: context?.correlationId || null,
          externalRequestId: context?.externalRequestId || null,
          attempt: attempt + 1,
          error: err.message
        });
        await logPermanentError(err, attempt + 1, context);
        return {
          success: false,
          notificationId: null,
          result: null,
          error: err,
          attempt: attempt + 1,
        };
      }
    }

    if (attempt < limit - 1) {
      const delayMs = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1];
      logInfo('Notification transient failure retry scheduled', {
        service_name: 'notification_dispatch',
        correlationId: context?.correlationId || null,
        externalRequestId: context?.externalRequestId || null,
        attempt: attempt + 1,
        nextDelayMs: delayMs
      });
      await sleep(delayMs);
    }
  }

  logError('Notification retries exhausted', {
    service_name: 'notification_dispatch',
    correlationId: context?.correlationId || null,
    externalRequestId: context?.externalRequestId || null,
    maxAttempts: limit,
    committeeId: context?.committeeId || null,
    error: lastError?.message || 'Max retries exhausted'
  });

  await logExhaustedRetries(lastError, limit, context);

  return {
    success: false,
    notificationId: null,
    result: null,
    error: lastError || new Error('Max retries exhausted'),
    attempt: limit,
  };
};

module.exports = {
  isTransientError,
  retryNotificationWithBackoff,
};
