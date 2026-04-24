/**
 * ================================================================================
 * ISSUE #241: WebhookDelivery Model — Webhook Job Lifecycle Tracking
 * ================================================================================
 *
 * Purpose:
 * Track the complete lifecycle of webhook delivery attempts (sync jobs, retries,
 * failures) with fingerprinting support for idempotency. Each webhook represents
 * a single delivery job that may be retried multiple times.
 *
 * Lifecycle Diagram:
 *   Created (POST) → PENDING → IN_FLIGHT → SUCCEEDED (status 2xx)
 *                           ↘→ FAILED (after max retries)
 *
 * Key Features:
 * 1. Fingerprint-based deduplication (SHA256 hash of payload)
 * 2. Retry tracking with exponential backoff
 * 3. CorrelationId propagation for tracing
 * 4. Complete request/response capture for debugging
 * 5. Compound indexes for efficient queries
 *
 * ================================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ISSUE #241: Define webhook delivery status enum
const WEBHOOK_STATUS = {
  PENDING: 'PENDING',           // Created but not yet sent
  IN_FLIGHT: 'IN_FLIGHT',       // Currently being processed (mid-retry)
  SUCCEEDED: 'SUCCEEDED',       // Successfully delivered (status 2xx)
  FAILED: 'FAILED'              // Failed after max retries exhausted
};

// ISSUE #241: WebhookDelivery Schema
// This model tracks each webhook delivery attempt with retry history
const webhookDeliverySchema = new Schema({
  // ISSUE #241: Core webhook identifiers
  webhookId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => require('uuid').v4()
  },

  // ISSUE #241: Idempotency key for duplicate detection
  // Allows client to safely retry requests with same key
  idempotencyKey: {
    type: String,
    required: true,
    index: true
  },

  // ISSUE #241: Request fingerprint (SHA256 hash)
  // Hash of JSON.stringify(payload) + idempotencyKey
  // Used to detect duplicate requests even with different idempotency keys
  fingerprint: {
    type: String,
    required: true,
    index: true
  },

  // ISSUE #241: Webhook delivery status
  // Track progression: PENDING → IN_FLIGHT → SUCCEEDED/FAILED
  status: {
    type: String,
    enum: Object.values(WEBHOOK_STATUS),
    default: WEBHOOK_STATUS.PENDING,
    index: true
  },

  // ISSUE #241: CorrelationId for tracing
  // Links this webhook to the request that triggered it
  correlationId: {
    type: String,
    required: true,
    index: true
  },

  // ISSUE #241: Target endpoint information
  // Identifies which service this webhook targets
  targetService: {
    type: String,
    enum: ['JIRA', 'GitHub', 'Notification'],
    required: true,
    index: true
  },

  // ISSUE #241: Original request payload
  // Complete copy of the HTTP request body sent to external service
  payload: {
    type: Schema.Types.Mixed,
    required: true
  },

  // ISSUE #241: External service response
  // Response from JIRA/GitHub/notification service (null if not yet sent)
  response: {
    statusCode: Number,
    headers: Schema.Types.Mixed,
    body: Schema.Types.Mixed
  },

  // ISSUE #241: Retry tracking
  // Track number of delivery attempts and backoff strategy
  retryCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // ISSUE #241: Error tracking
  // Capture error from most recent retry attempt
  lastError: {
    message: String,
    stack: String,
    code: String,  // e.g., 'ECONNREFUSED', 'TIMEOUT', 'INVALID_RESPONSE'
    timestamp: Date
  },

  // ISSUE #241: Retry schedule
  // Stores scheduled timestamps for exponential backoff retry attempts
  // Format: [timestamp1, timestamp2, timestamp3]
  scheduledRetries: [{
    type: Date,
    index: true
  }],

  // ISSUE #241: Context information
  // Enriched context about what triggered this webhook
  context: {
    groupId: String,
    sprintId: String,
    studentIds: [String],
    actionType: String,  // e.g., 'CONTRIBUTION_SYNC', 'SPRINT_FINALIZATION'
    initiatedBy: String  // User ID that triggered the operation
  },

  // ISSUE #241: Audit trail
  // Track key lifecycle events with timestamps
  events: [{
    _id: false,
    eventType: {
      type: String,
      enum: [
        'WEBHOOK_CREATED',
        'WEBHOOK_DISPATCHED',
        'WEBHOOK_SUCCEEDED',
        'WEBHOOK_FAILED',
        'WEBHOOK_RETRIED',
        'WEBHOOK_DEDUPLICATED'
      ]
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: Schema.Types.Mixed
  }],

  // ISSUE #241: Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// ================================================================================
// ISSUE #241: COMPOUND INDEXES FOR EFFICIENT QUERIES
// ================================================================================

/**
 * ISSUE #241: Index 1 — Query webhooks by status and creation time
 * Use case: Background job to retry PENDING/IN_FLIGHT webhooks
 * Query: db.webhookDeliveries.find({ status: 'PENDING', createdAt: { $lt: retryTime } })
 */
webhookDeliverySchema.index({ status: 1, createdAt: 1 });

/**
 * ISSUE #241: Index 2 — Query webhooks by idempotencyKey and fingerprint
 * Use case: Check if request is duplicate for idempotency enforcement
 * Query: db.webhookDeliveries.findOne({ idempotencyKey: 'key', fingerprint: 'hash' })
 */
webhookDeliverySchema.index({ idempotencyKey: 1, fingerprint: 1 });

/**
 * ISSUE #241: Index 3 — Query webhooks by correlationId for tracing
 * Use case: Operator debugging: find all webhooks triggered by single request
 * Query: db.webhookDeliveries.find({ correlationId: 'corr_123_abc' })
 */
webhookDeliverySchema.index({ correlationId: 1, createdAt: -1 });

/**
 * ISSUE #241: Index 4 — Query webhooks by context for analytics
 * Use case: Find all webhook deliveries for a specific sprint/group
 * Query: db.webhookDeliveries.find({ 'context.groupId': 'g123', 'context.sprintId': 's456' })
 */
webhookDeliverySchema.index({ 'context.groupId': 1, 'context.sprintId': 1, createdAt: -1 });

// ================================================================================
// ISSUE #241: INSTANCE METHODS
// ================================================================================

/**
 * ISSUE #241: Mark webhook as successfully delivered
 * @param {Object} response - HTTP response from external service
 */
webhookDeliverySchema.methods.markSucceeded = async function(response) {
  this.status = WEBHOOK_STATUS.SUCCEEDED;
  this.response = {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body
  };

  // ISSUE #241: Log the success event
  this.events.push({
    eventType: 'WEBHOOK_SUCCEEDED',
    timestamp: new Date(),
    details: { statusCode: response.statusCode }
  });

  return this.save();
};

/**
 * ISSUE #241: Mark webhook as failed
 * @param {Error} error - Error object from delivery attempt
 * @param {Boolean} isFinal - Is this the final attempt?
 */
webhookDeliverySchema.methods.markFailed = async function(error, isFinal = false) {
  this.lastError = {
    message: error.message,
    stack: error.stack,
    code: error.code,
    timestamp: new Date()
  };

  if (isFinal) {
    this.status = WEBHOOK_STATUS.FAILED;
    this.events.push({
      eventType: 'WEBHOOK_FAILED',
      timestamp: new Date(),
      details: { error: error.message, retryCount: this.retryCount }
    });
  } else {
    this.events.push({
      eventType: 'WEBHOOK_RETRIED',
      timestamp: new Date(),
      details: { error: error.message, retryCount: this.retryCount }
    });
  }

  return this.save();
};

/**
 * ISSUE #241: Check if webhook should be retried
 * Implements exponential backoff: [100ms, 200ms, 400ms]
 * @returns {Boolean} Whether retry should be attempted
 */
webhookDeliverySchema.methods.canRetry = function() {
  // ISSUE #241: Max 3 retries allowed
  if (this.retryCount >= 3) {
    return false;
  }

  // ISSUE #241: Status must allow retry
  if (![WEBHOOK_STATUS.PENDING, WEBHOOK_STATUS.IN_FLIGHT].includes(this.status)) {
    return false;
  }

  return true;
};

/**
 * ISSUE #241: Calculate next retry delay (exponential backoff)
 * @returns {Number} Delay in milliseconds
 */
webhookDeliverySchema.methods.getNextRetryDelay = function() {
  // ISSUE #241: Exponential backoff: 100ms * 2^retryCount
  // Attempt 1 after 100ms, Attempt 2 after 200ms, Attempt 3 after 400ms
  const baseDelay = 100;
  return baseDelay * Math.pow(2, this.retryCount);
};

/**
 * ISSUE #241: Mark webhook as being processed (in-flight)
 */
webhookDeliverySchema.methods.markInFlight = async function() {
  this.status = WEBHOOK_STATUS.IN_FLIGHT;
  this.retryCount += 1;
  this.events.push({
    eventType: 'WEBHOOK_DISPATCHED',
    timestamp: new Date(),
    details: { attempt: this.retryCount }
  });

  return this.save();
};

/**
 * ISSUE #241: Get all webhooks for a specific context (for operator debugging)
 * @param {String} correlationId - CorrelationId to trace
 * @returns {Array} All webhooks in this correlation context
 */
webhookDeliverySchema.statics.getByCorrelationId = function(correlationId) {
  return this.find({ correlationId }).sort({ createdAt: -1 });
};

/**
 * ISSUE #241: Get webhook delivery status summary
 * For dashboard/monitoring: show delivery success rate, retry rates, etc.
 * @returns {Object} Status summary with counts by status and service
 */
webhookDeliverySchema.statics.getStatusSummary = function() {
  return this.aggregate([
    {
      $group: {
        _id: { status: '$status', service: '$targetService' },
        count: { $sum: 1 }
      }
    }
  ]);
};

// ================================================================================
// ISSUE #241: EXPORTS
// ================================================================================

const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);

module.exports = {
  WebhookDelivery,
  WEBHOOK_STATUS,
  webhookDeliverySchema
};
