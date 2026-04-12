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
 * - Backoff delays: [100ms, 200ms, 400ms] between attempts (indices 0..maxRetries-2)
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
 * Dispatch result is successful when the dispatcher sets success (Issue #87 contract).
 * @param {object} result
 * @returns {boolean}
 */
const isDispatchSuccess = (result) => result && result.success === true;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a string suitable for SyncErrorLog.lastError (schema: String).
 */
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

/**
 * Issue #87: Persist failed notification sync per SyncErrorLog schema
 */
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

/**
 * Issue #87: Log and store permanent error to audit trail
 */
const logPermanentError = async (error, attempt, context) => {
  try {
    await createNotificationSyncErrorLog(error, attempt, context);
  } catch (logErr) {
    console.error('[Notification] Failed to log permanent error:', logErr.message);
  }
};

/**
 * Issue #87: Log and store exhausted retries to audit trail
 */
const logExhaustedRetries = async (error, maxRetries, context) => {
  try {
    await createNotificationSyncErrorLog(error, maxRetries, context);
  } catch (logErr) {
    console.error('[Notification] Failed to log max retries error:', logErr.message);
  }
};

/**
 * Issue #87: Retry dispatch function with exponential backoff
 *
 * @param {Function} dispatchFn - Async function to retry (must return { success, notificationId } on success)
 * @param {object} options
 * @param {number} options.maxRetries - Max attempts (default: 3)
 * @param {number[]} options.backoffMs - Backoff delays in milliseconds (default: [100, 200, 400])
 * @param {object} options.context - { committeeId, groupId, actorId } for SyncErrorLog
 *
 * @returns {Promise<object>} { success, notificationId, result, error, attempt }
 */
const retryNotificationWithBackoff = async (dispatchFn, options = {}) => {
  const {
    maxRetries = 3,
    backoffMs = [100, 200, 400],
    context = {},
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      console.log(
        `[Notification] Dispatch attempt ${attempt + 1}/${maxRetries} for committeeId: ${context.committeeId}`
      );

      const result = await dispatchFn();

      if (isDispatchSuccess(result)) {
        console.log(
          `[Notification] SUCCESS on attempt ${attempt + 1}: ${result.notificationId}`
        );
        return {
          success: true,
          notificationId: result.notificationId,
          result,
          error: null,
          attempt: attempt + 1,
        };
      }

      lastError = result?.error || new Error('Dispatch returned failure');
      console.log(`[Notification] Dispatch returned failure: ${lastError.message}`);

      if (!isTransientError(lastError)) {
        console.log(`[Notification] Permanent error (no retry): ${lastError.message}`);
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
      console.log(`[Notification] Exception caught: ${err.message}`);

      if (!isTransientError(err)) {
        console.log(`[Notification] Permanent exception (no retry): ${err.message}`);
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

    if (attempt < maxRetries - 1) {
      const delayMs = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1];
      console.log(`[Notification] Transient error, retrying after ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  console.log(
    `[Notification] All ${maxRetries} attempts exhausted for committeeId: ${context.committeeId}`
  );

  await logExhaustedRetries(lastError, maxRetries, context);

  return {
    success: false,
    notificationId: null,
    result: null,
    error: lastError || new Error('Max retries exhausted'),
    attempt: maxRetries,
  };
};

module.exports = {
  isTransientError,
  retryNotificationWithBackoff,
};
