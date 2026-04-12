const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Helper: Standalone sleep utility
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * isTransientError(error)
 * Classifies error as transient (retry) or permanent (fail immediately).
 * - TRANSIENT: 5xx server errors, 429 rate limit, network timeouts, ECONNREFUSED
 * - PERMANENT: 4xx (except 429), invalid input, validation errors
 */
function isTransientError(error) {
  if (!error) return false;

  const status = error.response?.status || error.status;
  const message = error.message || '';

  if (status >= 500 && status < 600) return true;
  if (status === 429) return true;
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) return true;
  if (message.includes('timeout') || message.includes('network')) return true;

  if (status >= 400 && status < 500) return false;

  return true;
}

/**
 * retryNotificationWithBackoff(dispatchFn, options)
 * Specialized retry logic for the Notification Service with exponential backoff and DB logging.
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

      if (!isTransient) {
        return handlePermanentError(error, context);
      }

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[Notification] Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }

  console.error('[Notification] All retries exhausted');
  return handleTransientExhaustedError(lastError, context);
}

/**
 * withRetry(fn, maxRetries, delays)
 * Generic utility from main branch to retry any async function with specified delays.
 */
async function withRetry(fn, maxRetries = 3, delays = [100, 200, 400]) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const wait = delays[attempt] !== undefined ? delays[attempt] : delays[delays.length - 1] || 0;
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

/**
 * Helpers for DB Error Logging
 */
async function handlePermanentError(error, context) {
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
    console.error('[Notification] SyncErrorLog creation failed:', logErr.message);
  }
  return { success: false, notificationId: null, error };
}

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
    console.error('[Notification] SyncErrorLog creation failed:', logErr.message);
  }
  return { success: false, notificationId: null, error: lastError };
}

module.exports = {
  retryNotificationWithBackoff,
  isTransientError,
  withRetry,
  sleep
};