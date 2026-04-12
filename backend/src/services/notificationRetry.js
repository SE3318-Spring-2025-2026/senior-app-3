/**
 * Notification retry service — exponential backoff for Notification Service calls.
 * Used by committee notifications and dispatchCommitteePublishNotification.
 */

const SyncErrorLog = require('../models/SyncErrorLog');

const isTransientError = (error) => {
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
    console.error('[Notification] Failed to log permanent error:', logErr.message);
  }
};

const logExhaustedRetries = async (error, maxRetries, context) => {
  try {
    await createNotificationSyncErrorLog(error, maxRetries, context);
  } catch (logErr) {
    console.error('[Notification] Failed to log max retries error:', logErr.message);
  }
};

/**
 * @param {Function} dispatchFn - async () => result with { success, notificationId?, error? }
 * @param {object} options.context - { committeeId?, groupId?, actorId? } for SyncErrorLog
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
        console.log(`[Notification] SUCCESS on attempt ${attempt + 1}: ${result.notificationId}`);
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
