const axios = require('axios');
const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Determine if an error is transient (retryable)
 * @param {Error|object} error - Error object or response
 * @returns {boolean} True if error is transient (5xx, 429, network errors)
 */
const isTransientError = (error) => {
  // Network errors are transient
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // HTTP status codes
  if (error.response) {
    const status = error.response.status;
    // 5xx errors are transient
    if (status >= 500) return true;
    // 429 (Too Many Requests) is transient
    if (status === 429) return true;
    // 4xx errors (except 429) are not transient
    return false;
  }

  // Unknown errors treated as transient
  return true;
};

/**
 * Retry a notification dispatch function with exponential backoff
 * @param {Function} dispatchFn - Async function to retry
 * @param {object} options - Retry options
 * @returns {Promise<object>} Result with success status and notificationId
 */
const retryNotificationWithBackoff = async (
  dispatchFn,
  options = {}
) => {
  const maxRetries = options.maxRetries || 3;
  const backoffMs = options.backoffMs || [100, 200, 400]; // Exponential backoff
  const timeout = options.timeout || 5000;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        dispatchFn(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Notification timeout')),
            timeout
          )
        ),
      ]);

      console.log(`[Notification] Dispatch succeeded on attempt ${attempt + 1}`);
      return {
        success: true,
        notificationId: result.notificationId,
        attempt: attempt + 1,
      };
    } catch (error) {
      lastError = error;
      console.log(
        `[Notification] Attempt ${attempt + 1} failed: ${error.message}`
      );

      // Check if error is transient
      if (!isTransientError(error)) {
        console.log('[Notification] Non-transient error, failing immediately');
        break;
      }

      // If not last attempt, wait before retrying
      if (attempt < maxRetries - 1) {
        const waitMs = backoffMs[attempt] || 400;
        console.log(`[Notification] Waiting ${waitMs}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  // Log error after all retries exhausted
  console.error(
    `[Notification] All ${maxRetries} attempts failed:`,
    lastError?.message
  );

  try {
    await SyncErrorLog.create({
      errorType: 'NOTIFICATION_DISPATCH_FAILED',
      errorMessage: lastError?.message || 'Unknown error',
      sourceSystem: 'CommitteeNotificationService',
      targetSystem: 'NotificationService',
      attempts: maxRetries,
      lastError: lastError?.response?.data || lastError?.message,
      timestamp: new Date(),
    });
  } catch (logError) {
    console.error('[Notification] Failed to create error log:', logError.message);
  }

  return {
    success: false,
    notificationId: null,
    error: lastError?.message,
    attempt: maxRetries,
  };
};

module.exports = {
  isTransientError,
  retryNotificationWithBackoff,
};
