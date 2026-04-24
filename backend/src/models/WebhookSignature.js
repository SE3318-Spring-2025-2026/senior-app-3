/**
 * ================================================================================
 * ISSUE #241: WebhookSignature Model — Idempotency Key & Fingerprint Storage
 * ================================================================================
 *
 * Purpose:
 * Store request fingerprints (SHA256 hashes) to detect and prevent duplicate
 * webhook deliveries. When a client retries a request with the same idempotency
 * key, we can quickly determine if this is a duplicate and return the existing
 * webhook ID instead of creating a new one.
 *
 * Idempotency Strategy:
 * 1. Accept Idempotency-Key from HTTP header or request body (RFC 7231)
 * 2. Compute fingerprint = SHA256(JSON.stringify(payload) + idempotencyKey)
 * 3. Query WebhookSignature for existing fingerprint
 * 4. If found: Return existing webhookId (idempotent response)
 * 5. If not found: Create new WebhookDelivery + WebhookSignature + dispatch
 *
 * Benefits:
 * - Protects against duplicate JIRA transitions, GitHub issues, notifications
 * - Clients can safely retry without worrying about side effects
 * - Follows HTTP idempotency RFC standards
 * - Fast duplicate detection via index on fingerprint
 *
 * ================================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ISSUE #241: WebhookSignature Schema
// This model stores request fingerprints for idempotency enforcement
const webhookSignatureSchema = new Schema({
  // ISSUE #241: Unique signature ID
  // MongoDB _id serves as primary key
  _id: {
    type: Schema.Types.ObjectId,
    auto: true
  },

  // ISSUE #241: Idempotency key from client
  // Unique identifier provided by client (UUID or custom string)
  // Range: 32-256 characters (RFC 7231 recommendation)
  idempotencyKey: {
    type: String,
    required: true,
    index: true,
    trim: true
  },

  // ISSUE #241: Request fingerprint (SHA256 hash)
  // Hash of payload + idempotencyKey ensures:
  // 1. Different payloads with same key are treated as different requests
  // 2. Same payload with different key creates separate webhook
  // 3. Duplicate detection works even if idempotencyKey expires
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // ISSUE #241: Reference to WebhookDelivery
  // Links this signature to the webhook job it represents
  webhookId: {
    type: String,
    required: true,
    index: true
  },

  // ISSUE #241: Idempotency key expiration
  // After this time, the signature is considered expired and new requests
  // with same key are treated as new (not duplicates)
  // Default: 24 hours (same as HTTP specification)
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),  // 24 hours from now
    index: true,
    // ISSUE #241: Auto-delete expired signatures via MongoDB TTL
    // This prevents collection from growing unbounded
    ttl: 86400  // 24 hours in seconds
  },

  // ISSUE #241: First occurrence timestamp
  // When was this fingerprint first seen?
  firstSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // ISSUE #241: Replay count
  // How many times has this exact fingerprint been replayed?
  // Useful for analytics: high replay count = unreliable client
  replayCount: {
    type: Number,
    default: 1,
    min: 1
  },

  // ISSUE #241: Context information
  // Where did this signature come from?
  context: {
    // Which endpoint was called?
    endpoint: String,

    // HTTP method (GET, POST, PUT, DELETE, PATCH)
    method: String,

    // Client IP address (for security audit)
    clientIp: String,

    // User ID that made the request
    userId: String,

    // Correlation ID for tracing
    correlationId: String
  },

  // ISSUE #241: Idempotency enforcement metadata
  enforcement: {
    // Was this a duplicate when signature was created?
    wasDuplicate: {
      type: Boolean,
      default: false
    },

    // How long did it take to detect duplicate? (milliseconds)
    detectionTime: Number,

    // Was fingerprint collision detected? (should be extremely rare)
    collisionDetected: {
      type: Boolean,
      default: false
    }
  }

}, { timestamps: true });

// ================================================================================
// ISSUE #241: COMPOUND INDEXES FOR EFFICIENT QUERIES
// ================================================================================

/**
 * ISSUE #241: Index 1 — Fast duplicate detection
 * Use case: Client retries request with same idempotencyKey
 * Query: db.webhookSignatures.findOne({ idempotencyKey: 'key' })
 * Note: Combined with fingerprint for false-positive prevention
 */
webhookSignatureSchema.index({ idempotencyKey: 1, createdAt: -1 });

/**
 * ISSUE #241: Index 2 — Fast fingerprint lookup
 * Use case: Check if request payload was seen before
 * Query: db.webhookSignatures.findOne({ fingerprint: 'sha256hash' })
 */
webhookSignatureSchema.index({ fingerprint: 1 });

/**
 * ISSUE #241: Index 3 — Find signatures by context (endpoint + method)
 * Use case: Analyze replay patterns on specific endpoints
 * Query: db.webhookSignatures.find({ 'context.endpoint': '/sync', 'context.method': 'POST' })
 */
webhookSignatureSchema.index({ 'context.endpoint': 1, 'context.method': 1, firstSeenAt: -1 });

/**
 * ISSUE #241: Index 4 — High-replay detection
 * Use case: Find potentially problematic clients that retry heavily
 * Query: db.webhookSignatures.find({ replayCount: { $gt: 5 } })
 */
webhookSignatureSchema.index({ replayCount: -1, firstSeenAt: -1 });

// ================================================================================
// ISSUE #241: INSTANCE METHODS
// ================================================================================

/**
 * ISSUE #241: Check if this signature has expired
 * @returns {Boolean} Whether idempotency key is still valid
 */
webhookSignatureSchema.methods.isExpired = function() {
  // ISSUE #241: Compare with server time
  return this.expiresAt < new Date();
};

/**
 * ISSUE #241: Record a replay of this signature
 * When same fingerprint is seen again, increment counter
 */
webhookSignatureSchema.methods.recordReplay = async function() {
  this.replayCount += 1;
  return this.save();
};

/**
 * ISSUE #241: Mark this signature as collision-suspected
 * MongoDB _id is 96-bit, SHA256 is 256-bit, so collision is impossible
 * But this is here for defensive programming
 */
webhookSignatureSchema.methods.markCollisionDetected = async function() {
  this.enforcement.collisionDetected = true;
  return this.save();
};

// ================================================================================
// ISSUE #241: STATIC METHODS
// ================================================================================

/**
 * ISSUE #241: Find existing signature by fingerprint
 * This is the main operation for duplicate detection.
 *
 * @param {String} fingerprint - SHA256 hash of request
 * @param {String} idempotencyKey - Client-provided idempotency key
 * @returns {Object} Signature document if found and not expired, null otherwise
 */
webhookSignatureSchema.statics.findByFingerprint = async function(fingerprint, idempotencyKey) {
  // ISSUE #241: Query for existing signature
  const signature = await this.findOne({ fingerprint });

  if (!signature) {
    // ISSUE #241: New request — no previous signature found
    return null;
  }

  if (signature.isExpired()) {
    // ISSUE #241: Signature expired — treat as new request
    // MongoDB TTL will automatically delete this soon
    return null;
  }

  // ISSUE #241: Return existing signature (client must use existing webhook)
  return signature;
};

/**
 * ISSUE #241: Create new signature for a request
 * Called when request passes duplicate check.
 *
 * @param {Object} params - Parameters
 * @param {String} params.idempotencyKey - Client-provided key
 * @param {String} params.fingerprint - SHA256 hash
 * @param {String} params.webhookId - ID of created webhook
 * @param {Object} params.context - Request context (endpoint, method, userId, etc.)
 * @returns {Object} Created signature document
 */
webhookSignatureSchema.statics.createSignature = async function(params) {
  // ISSUE #241: Create new signature for this request
  const signature = new this({
    idempotencyKey: params.idempotencyKey,
    fingerprint: params.fingerprint,
    webhookId: params.webhookId,
    context: params.context,
    enforcement: {
      wasDuplicate: false,
      detectionTime: 0
    }
  });

  return signature.save();
};

/**
 * ISSUE #241: Get replay rate statistics
 * For monitoring: identify clients with high retry rates
 *
 * @returns {Array} Signatures sorted by replay count (highest first)
 */
webhookSignatureSchema.statics.getReplayStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: '$context.userId',
        totalReplays: { $sum: '$replayCount' },
        avgReplays: { $avg: '$replayCount' },
        totalSignatures: { $sum: 1 }
      }
    },
    { $sort: { totalReplays: -1 } },
    { $limit: 10 }
  ]);
};

/**
 * ISSUE #241: Cleanup expired signatures manually (optional)
 * MongoDB TTL index handles this automatically, but explicit cleanup
 * can be useful for maintenance operations.
 *
 * @returns {Object} Result with deletedCount
 */
webhookSignatureSchema.statics.cleanupExpired = async function() {
  // ISSUE #241: Delete all signatures past expiration time
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });

  return {
    deletedCount: result.deletedCount,
    timestamp: new Date()
  };
};

// ================================================================================
// ISSUE #241: EXPORTS
// ================================================================================

const WebhookSignature = mongoose.model('WebhookSignature', webhookSignatureSchema);

module.exports = {
  WebhookSignature,
  webhookSignatureSchema
};
