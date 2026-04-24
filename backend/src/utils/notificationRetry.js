const axios = require('axios');
const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * Determines if an error is transient (should retry) or permanent (should not retry).
 * Transient errors: network timeouts, 5xx server errors, 429 rate limit
 * Permanent errors: 4xx client errors (except 429)
 *
 * @param {Error} error - The error to classify
 * @returns {boolean} true if error is transient and should retry
 */
const isTransientError = (error) => {
  // Network errors (no response) are transient
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  // 5xx server errors are transient
  if (status >= 500) {
    return true;
  }

  // 429 rate limiting is transient
  if (status === 429) {
    return true;
  }

  // All other errors (4xx except 429) are permanent
  return false;
};

/**
 * Retry a notification dispatch function with exponential backoff.
 * Classifies errors as transient or permanent:
 * - Transient errors (network, 5xx, 429): retry up to maxAttempts
 * - Permanent errors (4xx except 429): fail immediately
 *
 * @param {Function} dispatchFn - Async function that dispatches notification
 * @param {object} options - Retry configuration
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.initialBackoffMs - Initial backoff in ms (default: 100)
 * @param {string} options.identifier - ID for logging (requestId or groupId)
 * @param {string} options.identifierType - Type of identifier (requestId or groupId)
 * @returns {Promise<{success: boolean, notificationId: string|null, error: Error|null}>}
 */
const retryNotificationWithBackoff = async (
  dispatchFn,
  options = {}
) => {
  const {
    maxAttempts = 3,
    initialBackoffMs = 100,
    identifier = null,
    identifierType = 'requestId',
  } = options;

  let lastError = null;
  let notificationId = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await Promise.resolve(dispatchFn());
      notificationId = result?.notification_id || null;
      return { success: true, notificationId, error: null };
    } catch (err) {
      lastError = err;

      // Check if error is transient
      if (!isTransientError(err)) {
        // Permanent error - fail immediately without retrying
        console.error(
          `[Notification Dispatch] Permanent error on attempt ${attempt}/${maxAttempts} (${identifierType}: ${identifier}):`,
          err.message
        );
        return { success: false, notificationId: null, error: err };
      }

      // Transient error - retry if attempts remain
      if (attempt < maxAttempts) {
        const backoffMs = initialBackoffMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Notification Dispatch] Transient error on attempt ${attempt}/${maxAttempts} (${identifierType}: ${identifier}), retrying in ${backoffMs}ms:`,
          err.message
        );

        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } else {
        console.error(
          `[Notification Dispatch] Final transient error after ${maxAttempts} attempts (${identifierType}: ${identifier}):`,
          err.message
        );
      }
    }
  }

  // All retries exhausted - log to SyncErrorLog (schema: service, groupId, actorId, attempts, lastError)
  try {
    const groupId =
      identifierType === 'groupId' && identifier
        ? identifier
        : `notification_${identifierType}_${identifier || 'unknown'}`;
    await SyncErrorLog.create({
      service: 'notification',
      groupId,
      actorId: 'notification_retry',
      attempts: maxAttempts,
      correlationId: identifierType === 'requestId' ? identifier : null,
      serviceName: 'notification_retry',
      metadata: {
        identifierType,
        identifier,
      },
      lastError: `Failed after ${maxAttempts} attempts (${identifierType}: ${identifier}): ${lastError?.message}`,
    });
  } catch (logErr) {
    console.error(
      `Failed to create SyncErrorLog for notification failure (${identifierType}: ${identifier}):`,
      logErr.message
    );
  }

  return { success: false, notificationId: null, error: lastError };
};

module.exports = {
  retryNotificationWithBackoff,
  isTransientError,
};
