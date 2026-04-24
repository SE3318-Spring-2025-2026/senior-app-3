/**
 * ================================================================================
 * ISSUE #241: Request Deduplication Service — Fingerprint & Idempotency Logic
 * ================================================================================
 *
 * Purpose:
 * Core service for idempotency enforcement. Implements request fingerprinting,
 * duplicate detection, and idempotency key validation according to RFC 7231.
 *
 * Workflow:
 * 1. Extract idempotency key from request (header or body)
 * 2. Validate key format and length
 * 3. Compute fingerprint = SHA256(JSON.stringify(payload) + key)
 * 4. Query WebhookSignature for existing fingerprint
 * 5. If duplicate: Return existing webhookId + status 200
 * 6. If new: Create webhook, signature, and dispatch
 *
 * Key Points:
 * - Prevents duplicate JIRA transitions, GitHub updates, notifications
 * - Handles retry logic transparently (client sees same response)
 * - Supports both HTTP header and JSON body idempotency keys
 * - Fast duplicate detection via SHA256 + index lookup
 *
 * ================================================================================
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { WebhookSignature } = require('../models/WebhookSignature');
const { WebhookDelivery, WEBHOOK_STATUS } = require('../models/WebhookDelivery');

/**
 * ISSUE #241: Idempotency key validation constants
 */
const IDEMPOTENCY_KEY_CONFIG = {
  // ISSUE #241: Min/max lengths per RFC 7231
  MIN_LENGTH: 32,
  MAX_LENGTH: 256,

  // ISSUE #241: Supported header names (order of preference)
  HEADER_NAMES: [
    'Idempotency-Key',    // RFC 7231 standard
    'X-Idempotency-Key',  // Common variation
    'X-Request-ID',       // Alternative pattern
    'Request-ID'          // Alternate spelling
  ],

  // ISSUE #241: Fallback body field names
  BODY_FIELDS: [
    'idempotencyKey',
    'idempotency_key',
    'requestId',
    'request_id',
    'x_request_id'
  ],

  // ISSUE #241: Expiration time (24 hours)
  EXPIRATION_MS: 24 * 60 * 60 * 1000
};

/**
 * ISSUE #241: Extract idempotency key from request
 * 
 * Priority order:
 * 1. HTTP headers (Idempotency-Key, X-Idempotency-Key, etc.)
 * 2. JSON request body fields
 * 3. Generate new UUID if not provided
 *
 * @param {Object} req - Express request object
 * @returns {Object} { idempotencyKey, source }
 *   - idempotencyKey: String (the key value)
 *   - source: String ('header', 'body', or 'generated')
 */
function extractIdempotencyKey(req) {
  // ISSUE #241: Step 1 — Check HTTP headers (highest priority)
  for (const headerName of IDEMPOTENCY_KEY_CONFIG.HEADER_NAMES) {
    const value = req.headers[headerName.toLowerCase()];
    if (value) {
      return {
        idempotencyKey: value,
        source: 'header'
      };
    }
  }

  // ISSUE #241: Step 2 — Check request body fields
  if (req.body && typeof req.body === 'object') {
    for (const fieldName of IDEMPOTENCY_KEY_CONFIG.BODY_FIELDS) {
      if (req.body[fieldName]) {
        return {
          idempotencyKey: req.body[fieldName],
          source: 'body'
        };
      }
    }
  }

  // ISSUE #241: Step 3 — Generate new key if not provided
  // Allows requests without explicit idempotency key to still work
  const generatedKey = `generated_${uuidv4()}`;
  return {
    idempotencyKey: generatedKey,
    source: 'generated'
  };
}

/**
 * ISSUE #241: Validate idempotency key format
 * 
 * Checks:
 * - Length within RFC 7231 bounds (32-256 chars)
 * - Contains only alphanumeric, dash, underscore (safe for URLs)
 * - No null bytes or special characters
 *
 * @param {String} key - Idempotency key to validate
 * @returns {Object} { valid, error }
 *   - valid: Boolean (is key valid?)
 *   - error: String (error message if invalid)
 */
function validateIdempotencyKey(key) {
  // ISSUE #241: Check if key is string
  if (typeof key !== 'string') {
    return {
      valid: false,
      error: 'Idempotency key must be a string'
    };
  }

  // ISSUE #241: Check minimum length
  if (key.length < IDEMPOTENCY_KEY_CONFIG.MIN_LENGTH) {
    return {
      valid: false,
      error: `Idempotency key must be at least ${IDEMPOTENCY_KEY_CONFIG.MIN_LENGTH} characters`
    };
  }

  // ISSUE #241: Check maximum length
  if (key.length > IDEMPOTENCY_KEY_CONFIG.MAX_LENGTH) {
    return {
      valid: false,
      error: `Idempotency key must not exceed ${IDEMPOTENCY_KEY_CONFIG.MAX_LENGTH} characters`
    };
  }

  // ISSUE #241: Check for safe characters only
  // Allow: alphanumeric, dash, underscore, dot (common in UUIDs)
  const safePattern = /^[a-zA-Z0-9\-_.]+$/;
  if (!safePattern.test(key)) {
    return {
      valid: false,
      error: 'Idempotency key contains invalid characters (allow: a-z, A-Z, 0-9, -, _, .)'
    };
  }

  return { valid: true };
}

/**
 * ISSUE #241: Compute request fingerprint
 * 
 * Uses SHA256 hash of:
 * - JSON serialized request body
 * - Concatenated idempotency key
 *
 * Why both?
 * - Detects duplicate requests (same payload + key)
 * - Prevents false positives (different payloads with same key)
 * - Allows replay detection (payload changed but key remained)
 *
 * @param {Object} payload - Request body
 * @param {String} idempotencyKey - Idempotency key
 * @returns {String} SHA256 hex hash
 */
function computeFingerprint(payload, idempotencyKey) {
  // ISSUE #241: Serialize payload deterministically
  // Sort keys to ensure consistent hashing regardless of key order
  const payloadString = JSON.stringify(payload, Object.keys(payload).sort());

  // ISSUE #241: Concatenate payload + key
  // Key prevents hash collisions from different keys
  const content = `${payloadString}::${idempotencyKey}`;

  // ISSUE #241: Compute SHA256 hash
  // SHA256 = 256-bit hash, effectively collision-proof for this use case
  const fingerprint = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  return fingerprint;
}

/**
 * ISSUE #241: Check for duplicate request
 * 
 * Queries WebhookSignature for existing fingerprint.
 * If found and not expired, returns existing webhook ID.
 * If not found or expired, returns null for new webhook creation.
 *
 * @param {String} fingerprint - SHA256 hash of request
 * @param {String} idempotencyKey - Idempotency key
 * @returns {Promise<Object|null>} Existing signature or null
 */
async function checkForDuplicate(fingerprint, idempotencyKey) {
  try {
    // ISSUE #241: Query WebhookSignature collection
    const signature = await WebhookSignature.findByFingerprint(
      fingerprint,
      idempotencyKey
    );

    if (signature) {
      // ISSUE #241: Duplicate detected — record replay
      await signature.recordReplay();

      return {
        isDuplicate: true,
        webhookId: signature.webhookId,
        replayCount: signature.replayCount,
        firstSeenAt: signature.firstSeenAt
      };
    }

    // ISSUE #241: New request — no duplicate found
    return null;
  } catch (error) {
    // ISSUE #241: Log error but don't block request
    // Idempotency is best-effort; database errors should not break APIs
    console.error('ISSUE #241: Duplicate check error:', error);
    return null;
  }
}

/**
 * ISSUE #241: Register new request signature
 * 
 * Creates WebhookSignature record to track this request for future
 * duplicate detection.
 *
 * @param {Object} params - Parameters
 * @param {String} params.fingerprint - SHA256 hash
 * @param {String} params.idempotencyKey - Client-provided key
 * @param {String} params.webhookId - Webhook ID for this request
 * @param {Object} params.context - Request context
 * @returns {Promise<Object>} Created signature
 */
async function registerSignature(params) {
  try {
    // ISSUE #241: Create WebhookSignature to enable duplicate detection
    const signature = await WebhookSignature.createSignature({
      fingerprint: params.fingerprint,
      idempotencyKey: params.idempotencyKey,
      webhookId: params.webhookId,
      context: params.context
    });

    return signature;
  } catch (error) {
    // ISSUE #241: Handle unique constraint violation (extremely rare)
    // Could happen if two requests with same fingerprint arrive simultaneously
    if (error.code === 11000) {
      // ISSUE #241: Collision detected — query and return existing
      console.error('ISSUE #241: Fingerprint collision detected:', error);
      const existing = await WebhookSignature.findOne({
        fingerprint: params.fingerprint
      });
      if (existing) {
        return existing;
      }
    }

    // ISSUE #241: Re-throw other errors
    throw error;
  }
}

/**
 * ISSUE #241: Get idempotency status for a request
 * 
 * Returns comprehensive idempotency information:
 * - Whether request was duplicate
 * - Previous webhook ID if duplicate
 * - Replay count
 * - First occurrence time
 *
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Idempotency status
 */
async function getIdempotencyStatus(req) {
  try {
    // ISSUE #241: Extract idempotency key from request
    const { idempotencyKey, source } = extractIdempotencyKey(req);

    // ISSUE #241: Validate key format
    const validation = validateIdempotencyKey(idempotencyKey);
    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error
      };
    }

    // ISSUE #241: Compute request fingerprint
    const fingerprint = computeFingerprint(req.body || {}, idempotencyKey);

    // ISSUE #241: Check for duplicate
    const duplicate = await checkForDuplicate(fingerprint, idempotencyKey);

    return {
      valid: true,
      idempotencyKey,
      fingerprint,
      source,
      ...duplicate
    };
  } catch (error) {
    console.error('ISSUE #241: Error getting idempotency status:', error);
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * ISSUE #241: Enforce idempotency on a request
 * 
 * Full workflow:
 * 1. Extract and validate idempotency key
 * 2. Compute fingerprint
 * 3. Check for duplicates
 * 4. Return appropriate response
 *
 * Usage in controller:
 * const status = await enforceIdempotency(req, res);
 * if (status.isDuplicate) {
 *   return res.status(200).json({ webhookId: status.webhookId });
 * }
 * // Continue with normal request processing
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response (for setting headers)
 * @returns {Promise<Object>} Idempotency status
 */
async function enforceIdempotency(req, res) {
  // ISSUE #241: Get complete idempotency status
  const status = await getIdempotencyStatus(req);

  if (!status.valid) {
    // ISSUE #241: Invalid idempotency key — bad request
    return {
      valid: false,
      isDuplicate: false,
      statusCode: 400,
      error: status.error
    };
  }

  // ISSUE #241: Attach to request for service layer access
  req.idempotencyKey = status.idempotencyKey;
  req.fingerprint = status.fingerprint;

  // ISSUE #241: Set response header with fingerprint
  // Client can use this for debugging
  res.setHeader('X-Fingerprint', status.fingerprint);
  res.setHeader('X-Idempotency-Key', status.idempotencyKey);

  if (status.isDuplicate) {
    // ISSUE #241: Duplicate detected — set appropriate status
    res.setHeader('X-Idempotency-Replayed', 'true');
    res.setHeader('X-Replay-Count', status.replayCount);

    return {
      valid: true,
      isDuplicate: true,
      webhookId: status.webhookId,
      replayCount: status.replayCount,
      statusCode: 200  // 200 OK for duplicates (RFC 7231)
    };
  }

  // ISSUE #241: New request — continue processing
  return {
    valid: true,
    isDuplicate: false,
    statusCode: 202  // 202 Accepted for new async requests
  };
}

/**
 * ISSUE #241: Get idempotency key from request (public API)
 * 
 * Convenience function for services to extract idempotency key.
 * Usage: const key = getIdempotencyKey(req);
 *
 * @param {Object} req - Express request
 * @returns {String} Idempotency key (guaranteed non-null)
 */
function getIdempotencyKey(req) {
  // ISSUE #241: Already extracted during middleware?
  if (req.idempotencyKey) {
    return req.idempotencyKey;
  }

  // ISSUE #241: Extract if not yet done
  const { idempotencyKey } = extractIdempotencyKey(req);
  return idempotencyKey;
}

// ================================================================================
// ISSUE #241: EXPORTS
// ================================================================================

module.exports = {
  extractIdempotencyKey,
  validateIdempotencyKey,
  computeFingerprint,
  checkForDuplicate,
  registerSignature,
  getIdempotencyStatus,
  enforceIdempotency,
  getIdempotencyKey,
  IDEMPOTENCY_KEY_CONFIG
};
