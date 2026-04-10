const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Determine if error is transient (retryable)
 */
const isTransientError = (error) => {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return true;
  }

  if (error.response) {
    const status = error.response.status;
    if (status >= 500) return true;
    if (status === 429) return true;
    return false;
  }

  return true;
};

/**
 * Retry with exponential backoff
 */
const retryNotificationWithBackoff = async (dispatchFn, options = {}) => {
  const maxRetries = options.maxRetries || 3;
  const backoffMs = options.backoffMs || [100, 200, 400];
  const timeout = options.timeout || 5000;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        dispatchFn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Notification timeout')), timeout)
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
      console.log(`[Notification] Attempt ${attempt + 1} failed: ${error.message}`);

      if (!isTransientError(error)) {
        console.log('[Notification] Non-transient error, failing immediately');
        break;
      }

      if (attempt < maxRetries - 1) {
        const waitMs = backoffMs[attempt] || 400;
        console.log(`[Notification] Waiting ${waitMs}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  console.error(`[Notification] All ${maxRetries} attempts failed:`, lastError?.message);

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
