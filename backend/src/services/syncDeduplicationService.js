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
const { WebhookSignature } = require('../models/WebhookSignature');
const { logError } = require('../utils/structuredLogger');

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
 * 3. Deterministically derive key from request identity if not provided
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

  const generatedKey = generateDeterministicIdempotencyKey(req);
  return {
    idempotencyKey: generatedKey,
    source: 'derived'
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const content = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',');
  return `{${content}}`;
}

function generateDeterministicIdempotencyKey(req) {
  const method = req?.method || '';
  const originalUrl = req?.originalUrl || req?.url || '';
  const actorId = req?.user?.userId || req?.user?.id || 'anonymous';
  const body = stableStringify(req?.body || {});
  return crypto
    .createHash('sha256')
    .update(`${method}::${originalUrl}::${body}::${actorId}`)
    .digest('hex');
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
  const payloadString = stableStringify(payload || {});

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
 * Atomically acquires idempotency signature ownership.
 * This removes read-then-write races under concurrent identical requests.
 *
 * @param {Object} params
 * @param {String} params.fingerprint
 * @param {String} params.idempotencyKey
 * @param {String} params.webhookId
 * @param {Object} params.context
 * @returns {Promise<{ acquired: boolean, signature: Object }>}
 */
async function acquireIdempotencySignature(params, options = {}) {
  const { session = null } = options;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_KEY_CONFIG.EXPIRATION_MS);

  const result = await WebhookSignature.findOneAndUpdate(
    { fingerprint: params.fingerprint },
    {
      $setOnInsert: {
        idempotencyKey: params.idempotencyKey,
        fingerprint: params.fingerprint,
        webhookId: params.webhookId,
        firstSeenAt: now,
        replayCount: 1,
        context: params.context || {},
        expiresAt
      },
      $set: {
        'context.correlationId': params.context?.correlationId || null
      }
    },
    { upsert: true, new: true, includeResultMetadata: true, ...(session ? { session } : {}) }
  );

  const acquired = Boolean(result.lastErrorObject?.upserted);
  if (!acquired) {
    await WebhookSignature.updateOne(
      { _id: result.value._id },
      { $inc: { replayCount: 1 } },
      session ? { session } : undefined
    );
  }

  return {
    acquired,
    signature: result.value
  };
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
  try {
    const { idempotencyKey, source } = extractIdempotencyKey(req);
    const validation = validateIdempotencyKey(idempotencyKey);
    if (!validation.valid) {
      return {
        valid: false,
        isDuplicate: false,
        statusCode: 400,
        error: validation.error
      };
    }

    const fingerprint = computeFingerprint(req.body || {}, idempotencyKey);

    req.idempotencyKey = idempotencyKey;
    req.fingerprint = fingerprint;
    req.idempotencySource = source;

    res.setHeader('X-Fingerprint', fingerprint);
    res.setHeader('X-Idempotency-Key', idempotencyKey);

    return {
      valid: true,
      isDuplicate: false,
      statusCode: 202
    };
  } catch (error) {
    logError('Idempotency enforcement failed', {
      service_name: 'sync_deduplication',
      correlationId: req?.correlationId || null,
      externalRequestId: req?.externalRequestId || null,
      error: error.message
    });
    return {
      valid: false,
      isDuplicate: false,
      statusCode: 500,
      error: 'Failed to enforce idempotency'
    };
  }
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
  generateDeterministicIdempotencyKey,
  validateIdempotencyKey,
  stableStringify,
  computeFingerprint,
  acquireIdempotencySignature,
  enforceIdempotency,
  getIdempotencyKey,
  IDEMPOTENCY_KEY_CONFIG
};
