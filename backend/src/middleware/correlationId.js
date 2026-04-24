/**
 * ================================================================================
 * ISSUE #241: CorrelationId Middleware — Request Lifecycle Tracing
 * ================================================================================
 *
 * Purpose:
 * Generate or accept correlationId at request entry point and propagate it
 * through the entire request lifecycle for end-to-end tracing across JIRA sync,
 * GitHub sync, persistence, and notification pipelines.
 *
 * Benefits:
 * - Traces all operations (sync jobs, retries, notifications, audits) back to
 *   single source request
 * - Enables operator dashboards to correlate logs across microservices
 * - Supports distributed tracing patterns (OpenTelemetry compatible)
 * - Uniquely identifies user-facing operations in audit logs
 *
 * Pattern:
 * 1. Extract correlationId from X-Correlation-ID header (if present)
 * 2. Generate new UUID if not provided (format: corr_<timestamp>_<randomString>)
 * 3. Attach to req.correlationId for service layer access
 * 4. Attach to res.setHeader() for response tracing
 * 5. Propagate via cls (Continuation Local Storage) or async_hooks if needed
 *
 * ================================================================================
 */

const { v4: uuidv4 } = require('uuid');

/**
 * ISSUE #241: Generate unique correlation ID
 *
 * Format: corr_<timestamp>_<8char_random>
 * Example: corr_1713954000123_a1b2c3d4
 *
 * @returns {String} Unique correlation ID
 */
function generateCorrelationId() {
  // ISSUE #241: Use timestamp for sortability + random suffix for uniqueness
  const timestamp = Date.now();
  const randomSuffix = uuidv4().split('-')[0];  // First 8 chars of UUID
  return `corr_${timestamp}_${randomSuffix}`;
}

/**
 * ISSUE #241: Middleware to manage correlationId throughout request lifecycle
 *
 * Attach this to Express app EARLY in middleware chain:
 * app.use(correlationIdMiddleware());
 *
 * Then every request will have:
 * - req.correlationId: string (for service layer access)
 * - X-Correlation-ID response header: automatically set
 *
 * Usage in services:
 * const correlationId = req.correlationId;
 * await createAuditLog({
 *   action: 'JIRA_SYNC_INITIATED',
 *   payload: { correlationId, jobId, ... }
 * });
 *
 * @returns {Function} Express middleware function
 */
function correlationIdMiddleware() {
  return (req, res, next) => {
    // ISSUE #241: Step 1 — Extract correlationId from request headers
    // RFC 7231: X-Correlation-ID is common pattern for distributed tracing
    const incomingCorrelationId = req.headers['x-correlation-id'] ||
                                   req.headers['correlation-id'] ||
                                   req.body?.correlationId;

    // ISSUE #241: Step 2 — Use existing or generate new
    // Allows client-side tracing integration if they provide ID
    const correlationId = incomingCorrelationId || generateCorrelationId();

    // ISSUE #241: Step 3 — Attach to request object for service layer access
    // Services and controllers can access via req.correlationId
    req.correlationId = correlationId;

    // ISSUE #241: Step 4 — Set response header for client tracing
    // Client can use returned header to correlate with their logs
    res.setHeader('X-Correlation-ID', correlationId);

    // ISSUE #241: Optional: Attach to res.locals for template access
    res.locals.correlationId = correlationId;

    // ISSUE #241: Log entry point for debugging (dev mode only)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${correlationId}] ${req.method} ${req.path}`);
    }

    // ISSUE #241: Continue to next middleware
    next();
  };
}

/**
 * ISSUE #241: Helper to extract correlationId from request
 *
 * Can be called from any layer (controller, service, middleware)
 * to retrieve the active correlationId.
 *
 * @param {Object} req - Express request object
 * @returns {String} CorrelationId (falls back to generated if not set)
 */
function getCorrelationId(req) {
  // ISSUE #241: Return existing or generate fallback
  if (req && req.correlationId) {
    return req.correlationId;
  }

  // ISSUE #241: Fallback for edge cases (e.g., async tasks, background jobs)
  // This ensures every operation has a traceable ID
  return generateCorrelationId();
}

/**
 * ISSUE #241: Helper to pass correlationId to child async operations
 *
 * Usage in fire-and-forget patterns (e.g., setImmediate):
 * const correlationId = getCorrelationId(req);
 * setImmediate(async () => {
 *   await someAsyncOperation(correlationId);
 * });
 *
 * Then in someAsyncOperation:
 * await createAuditLog({
 *   payload: { correlationId, ... }
 * });
 *
 * @param {String} correlationId - CorrelationId to attach to child context
 * @returns {Object} Context object for async operations
 */
function createChildContext(correlationId) {
  // ISSUE #241: Create context object that can be passed to async operations
  // Future: Can be enhanced to support OpenTelemetry SpanContext
  return {
    correlationId,
    startTime: Date.now()
  };
}

// ================================================================================
// ISSUE #241: EXPORTS
// ================================================================================

module.exports = {
  correlationIdMiddleware,
  getCorrelationId,
  generateCorrelationId,
  createChildContext
};
