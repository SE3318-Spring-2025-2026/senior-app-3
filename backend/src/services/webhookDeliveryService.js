/**
 * ================================================================================
 * ISSUE #241: Webhook Delivery Service — Retry Logic & Async Dispatch
 * ================================================================================
 *
 * Purpose:
 * Orchestrate webhook delivery with robust retry logic, exponential backoff,
 * and failure tracking. Implements the complete delivery lifecycle:
 * PENDING → IN_FLIGHT → SUCCEEDED/FAILED
 *
 * Retry Strategy:
 * - Max 3 retry attempts (total 4 tries: initial + 3 retries)
 * - Exponential backoff: [100ms, 200ms, 400ms]
 * - Retry on transient failures (timeout, connection refused, 5xx)
 * - Don't retry on client errors (4xx)
 *
 * Dispatch Pattern:
 * - Use setImmediate() for fire-and-forget non-blocking dispatch
 * - Allows HTTP response to return immediately
 * - Webhooks processed asynchronously in background
 * - CorrelationId propagated through entire retry chain
 *
 * ================================================================================
 */

const { WebhookDelivery, WEBHOOK_STATUS } = require('../models/WebhookDelivery');
const { WebhookSignature } = require('../models/WebhookSignature');
const AuditLog = require('../models/AuditLog');
const { getCorrelationId, createChildContext } = require('../middleware/correlationId');
const { logError, logInfo } = require('../utils/structuredLogger');

/**
 * ISSUE #241: Configuration for retry logic
 */
const RETRY_CONFIG = {
  // ISSUE #241: Maximum number of retries (total attempts = 1 + maxRetries)
  MAX_RETRIES: 3,

  // ISSUE #241: Base delay for exponential backoff (milliseconds)
  BASE_DELAY_MS: 100,

  // ISSUE #241: Timeout for external service calls (milliseconds)
  REQUEST_TIMEOUT_MS: 30000,

  // ISSUE #241: Transient error codes that trigger retry
  TRANSIENT_ERRORS: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ERR_HTTP_REQUEST_TIMEOUT'
  ],

  // ISSUE #241: HTTP status codes that trigger retry
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504]
};

/**
 * ISSUE #241: Determine if error is transient (should retry)
 * 
 * Transient errors:
 * - Connection refused/reset
 * - Timeout
 * - Host unreachable
 * - 5xx server errors
 * - Rate limiting (429)
 *
 * Non-transient errors (don't retry):
 * - 400, 401, 403, 404 (client errors)
 * - Validation failures
 *
 * @param {Error} error - Error object
 * @param {Number} statusCode - HTTP status code (if applicable)
 * @returns {Boolean} Whether to retry
 */
function isTransientError(error, statusCode) {
  // ISSUE #241: Check HTTP status code
  if (statusCode) {
    // ISSUE #241: Retry on server errors, rate limiting, request timeout
    if (RETRY_CONFIG.RETRYABLE_STATUS_CODES.includes(statusCode)) {
      return true;
    }

    // ISSUE #241: Don't retry on client errors (4xx except specific ones)
    if (statusCode >= 400 && statusCode < 500) {
      return false;
    }
  }

  // ISSUE #241: Check error code (network/system errors)
  if (error && error.code) {
    if (RETRY_CONFIG.TRANSIENT_ERRORS.includes(error.code)) {
      return true;
    }
  }

  // ISSUE #241: Check error message for timeout indicators
  if (error && error.message) {
    const lowerMessage = error.message.toLowerCase();
    if (lowerMessage.includes('timeout') || lowerMessage.includes('econnrefused')) {
      return true;
    }
  }

  // ISSUE #241: Not a transient error — don't retry
  return false;
}

/**
 * ISSUE #241: Calculate next retry delay (exponential backoff)
 * 
 * Backoff progression:
 * - Attempt 1 (retry 0): 100ms
 * - Attempt 2 (retry 1): 200ms
 * - Attempt 3 (retry 2): 400ms
 *
 * Jitter: Add ±10% random variation to prevent thundering herd
 *
 * @param {Number} retryCount - Current retry count (0-indexed)
 * @returns {Number} Delay in milliseconds
 */
function getRetryDelay(retryCount) {
  // ISSUE #241: Exponential backoff: baseDelay * 2^retryCount
  const exponentialDelay = RETRY_CONFIG.BASE_DELAY_MS * Math.pow(2, retryCount);

  // ISSUE #241: Add jitter to prevent thundering herd
  // Jitter: ±10% of base delay
  const jitter = exponentialDelay * 0.1 * (Math.random() - 0.5);
  const delay = exponentialDelay + jitter;

  return Math.max(10, Math.round(delay));  // Minimum 10ms
}

/**
 * ISSUE #241: Dispatch webhook delivery job
 * 
 * Creates WebhookDelivery record and schedules for processing.
 * Returns immediately (non-blocking) for HTTP response.
 * Actual delivery happens asynchronously.
 *
 * @param {Object} params - Delivery parameters
 * @param {String} params.idempotencyKey - Idempotency key for duplicate detection
 * @param {String} params.fingerprint - SHA256 fingerprint
 * @param {String} params.targetService - JIRA | GitHub | Notification
 * @param {Object} params.payload - Request payload
 * @param {String} params.correlationId - CorrelationId for tracing
 * @param {Object} params.context - Context (groupId, sprintId, etc.)
 * @returns {Promise<Object>} Created WebhookDelivery
 */
async function dispatchWebhook(params) {
  try {
    // ISSUE #241: Create WebhookDelivery record
    const webhook = new WebhookDelivery({
      idempotencyKey: params.idempotencyKey,
      fingerprint: params.fingerprint,
      targetService: params.targetService,
      payload: params.payload,
      correlationId: params.correlationId,
      externalRequestId: params.externalRequestId || null,
      context: params.context,
      status: WEBHOOK_STATUS.PENDING,
      events: [{
        eventType: 'WEBHOOK_CREATED',
        timestamp: new Date(),
        details: {
          targetService: params.targetService,
          context: params.context
        }
      }]
    });

    // ISSUE #241: Save to database
    const savedWebhook = await webhook.save();

    // ISSUE #241: Log webhook creation
    await AuditLog.create({
      action: 'WEBHOOK_DELIVERY_INITIATED',
      user: params.context?.initiatedBy || 'system',
      payload: {
        webhookId: savedWebhook.webhookId,
        jobId: params.context?.jobId || null,
        correlationId: params.correlationId,
        externalRequestId: params.externalRequestId || null,
        groupId: params.context?.groupId || null,
        sprintId: params.context?.sprintId || null,
        targetService: params.targetService,
        idempotencyKey: params.idempotencyKey
      }
    });

    // ISSUE #241: Schedule for async processing (non-blocking)
    // Use setImmediate to defer to next event loop iteration
    setImmediate(() => {
      try {
        processWebhookDelivery(savedWebhook.webhookId, params.correlationId)
          .catch(error => {
            logError('Webhook processing error', {
              service_name: 'webhook_dispatch',
              correlationId: params.correlationId,
              externalRequestId: params.externalRequestId || null,
              webhookId: savedWebhook.webhookId,
              jobId: params.context?.jobId || null,
              error: error.message
            });
            // ISSUE #241: Error logged but not thrown (async task)
          });
      } catch (setImmediateErr) {
        logError('Webhook setImmediate dispatch failure', {
          service_name: 'webhook_dispatch',
          correlationId: params.correlationId,
          externalRequestId: params.externalRequestId || null,
          webhookId: savedWebhook.webhookId,
          jobId: params.context?.jobId || null,
          error: setImmediateErr.message
        });
      }
    });

    return savedWebhook;
  } catch (error) {
    logError('Error dispatching webhook', {
      service_name: 'webhook_dispatch',
      correlationId: params?.correlationId || null,
      externalRequestId: params?.externalRequestId || null,
      jobId: params?.context?.jobId || null,
      error: error.message
    });
    throw error;
  }
}

/**
 * ISSUE #241: Process webhook delivery with retries
 * 
 * Main async loop:
 * 1. Load webhook from database
 * 2. Mark as IN_FLIGHT
 * 3. Call executeWebhook() based on targetService
 * 4. If success: Mark as SUCCEEDED
 * 5. If transient error: Schedule retry
 * 6. If max retries exceeded: Mark as FAILED
 *
 * @param {String} webhookId - ID of webhook to process
 * @param {String} correlationId - CorrelationId for tracing
 * @returns {Promise<Object>} Final webhook status
 */
async function processWebhookDelivery(webhookId, correlationId) {
  // ISSUE #241: Create child context for async operation
  const ctx = createChildContext(correlationId);

  try {
    // ISSUE #241: Load webhook from database
    const webhook = await WebhookDelivery.findOne({ webhookId });
    if (!webhook) {
      throw new Error(`Webhook not found: ${webhookId}`);
    }

    // ISSUE #241: Check if already succeeded (idempotency for retries)
    if (webhook.status === WEBHOOK_STATUS.SUCCEEDED) {
      logInfo('Webhook already succeeded', {
        service_name: 'webhook_dispatch',
        correlationId,
        externalRequestId: webhook.externalRequestId || null,
        webhookId,
        jobId: webhook.context?.jobId || null
      });
      return webhook;
    }

    // ISSUE #241: Mark as IN_FLIGHT for this attempt
    await webhook.markInFlight();

    // ISSUE #241: Execute webhook based on target service
    let response;
    try {
      response = await executeWebhook(webhook, ctx);
    } catch (error) {
      // ISSUE #241: Execution failed — check if transient
      const isTransient = isTransientError(error, error.statusCode);
      const canRetry = webhook.canRetry();

      if (isTransient && canRetry) {
        // ISSUE #241: Transient error and retries remaining — schedule retry
        const retryDelay = getRetryDelay(webhook.retryCount);
        const nextRetryTime = new Date(Date.now() + retryDelay);

        webhook.scheduledRetries.push(nextRetryTime);
        await webhook.markFailed(error, false);

        // ISSUE #241: Log retry
        await AuditLog.create({
          action: 'WEBHOOK_DELIVERY_RETRIED',
          payload: {
            webhookId,
            jobId: webhook.context?.jobId || null,
            correlationId,
            externalRequestId: webhook.externalRequestId || null,
            groupId: webhook.context?.groupId || null,
            sprintId: webhook.context?.sprintId || null,
            attempt: webhook.retryCount,
            nextRetry: nextRetryTime,
            error: error.message
          }
        });

        // ISSUE #241: Schedule next attempt
        setTimeout(() => {
          processWebhookDelivery(webhookId, correlationId)
            .catch(e => logError('Webhook retry processing error', {
              service_name: 'webhook_dispatch',
              correlationId,
              externalRequestId: webhook.externalRequestId || null,
              webhookId,
              jobId: webhook.context?.jobId || null,
              error: e.message
            }));
        }, retryDelay);

        return { scheduled: true, nextRetry: nextRetryTime };
      } else {
        // ISSUE #241: Not transient or out of retries — final failure
        await webhook.markFailed(error, true);

        // ISSUE #241: Log final failure
        await AuditLog.create({
          action: 'WEBHOOK_DELIVERY_FAILED',
          payload: {
            webhookId,
            jobId: webhook.context?.jobId || null,
            correlationId,
            externalRequestId: webhook.externalRequestId || null,
            groupId: webhook.context?.groupId || null,
            sprintId: webhook.context?.sprintId || null,
            attempts: webhook.retryCount,
            error: error.message,
            statusCode: error.statusCode
          }
        });

        throw error;
      }
    }

    // ISSUE #241: Success — mark as SUCCEEDED
    await webhook.markSucceeded(response);

    // ISSUE #241: Log success
    await AuditLog.create({
      action: 'WEBHOOK_DELIVERY_SUCCEEDED',
      payload: {
        webhookId,
        jobId: webhook.context?.jobId || null,
        correlationId,
        externalRequestId: webhook.externalRequestId || null,
        groupId: webhook.context?.groupId || null,
        sprintId: webhook.context?.sprintId || null,
        attempt: webhook.retryCount,
        targetService: webhook.targetService,
        statusCode: response.statusCode
      }
    });

    return webhook;
  } catch (error) {
    logError('Final webhook error', {
      service_name: 'webhook_dispatch',
      correlationId,
      externalRequestId: null,
      webhookId,
      error: error.message
    });

    // ISSUE #241: Log unexpected error
    await AuditLog.create({
      action: 'WEBHOOK_DELIVERY_ERROR',
      payload: {
        webhookId,
        jobId: null,
        correlationId,
        error: error.message
      }
    }).catch(e => logError('Failed to persist webhook error audit', {
      service_name: 'webhook_dispatch',
      correlationId,
      externalRequestId: null,
      webhookId,
      error: e.message
    }));

    throw error;
  }
}

/**
 * ISSUE #241: Execute webhook based on target service
 * 
 * Routes to appropriate handler:
 * - JIRA: POST to JIRA webhook endpoint
 * - GitHub: POST to GitHub webhook endpoint
 * - Notification: POST to notification service
 *
 * @param {Object} webhook - WebhookDelivery document
 * @param {Object} ctx - Context with correlationId
 * @returns {Promise<Object>} Response { statusCode, headers, body }
 */
async function executeWebhook(webhook, ctx) {
  // ISSUE #241: Will be implemented in service-specific handlers
  // For now, return stub

  switch (webhook.targetService) {
    case 'JIRA':
      return executeJiraWebhook(webhook, ctx);
    case 'GitHub':
      return executeGithubWebhook(webhook, ctx);
    case 'Notification':
      return executeNotificationWebhook(webhook, ctx);
    default:
      throw new Error(`Unknown target service: ${webhook.targetService}`);
  }
}

/**
 * ISSUE #241: Execute JIRA webhook (stub)
 * To be implemented with actual JIRA API calls
 */
async function executeJiraWebhook(webhook, ctx) {
  throw new Error('JIRA webhook execution not yet implemented');
}

/**
 * ISSUE #241: Execute GitHub webhook (stub)
 * To be implemented with actual GitHub API calls
 */
async function executeGithubWebhook(webhook, ctx) {
  throw new Error('GitHub webhook execution not yet implemented');
}

/**
 * ISSUE #241: Execute Notification webhook (stub)
 * To be implemented with actual notification dispatch
 */
async function executeNotificationWebhook(webhook, ctx) {
  throw new Error('Notification webhook execution not yet implemented');
}

/**
 * ISSUE #241: Get webhook status and history
 * 
 * Returns complete delivery history for operator debugging.
 *
 * @param {String} webhookId - Webhook ID
 * @returns {Promise<Object>} Webhook with full event history
 */
async function getWebhookStatus(webhookId) {
  const webhook = await WebhookDelivery.findOne({ webhookId });
  if (!webhook) {
    throw new Error(`Webhook not found: ${webhookId}`);
  }

  return {
    webhookId: webhook.webhookId,
    status: webhook.status,
    targetService: webhook.targetService,
    retryCount: webhook.retryCount,
    events: webhook.events,
    lastError: webhook.lastError,
    response: webhook.response,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt
  };
}

/**
 * ISSUE #241: Get all webhooks for a correlation context
 * 
 * For operator dashboards: see all operations triggered by single request.
 *
 * @param {String} correlationId - CorrelationId to trace
 * @returns {Promise<Array>} All webhooks in this context
 */
async function getWebhooksByCorrelation(correlationId) {
  return WebhookDelivery.getByCorrelationId(correlationId);
}

/**
 * ISSUE #241: Get webhook delivery metrics
 * 
 * For monitoring: success rate, retry rates, error distribution.
 *
 * @returns {Promise<Object>} Aggregated metrics
 */
async function getWebhookMetrics() {
  const summary = await WebhookDelivery.getStatusSummary();

  return {
    summary,
    timestamp: new Date()
  };
}

// ================================================================================
// ISSUE #241: EXPORTS
// ================================================================================

module.exports = {
  dispatchWebhook,
  processWebhookDelivery,
  executeWebhook,
  getWebhookStatus,
  getWebhooksByCorrelation,
  getWebhookMetrics,
  isTransientError,
  getRetryDelay,
  RETRY_CONFIG
};
