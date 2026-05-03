/**
 * ================================================================================
 * ISSUE #241: Integration Tests — Operational Hooks & Idempotency
 * ================================================================================
 *
 * Purpose:
 * Comprehensive test suite for Issue #241 implementation covering:
 * 1. CorrelationId generation and propagation
 * 2. Idempotency key validation and duplicate detection
 * 3. Request fingerprinting (SHA256)
 * 4. Webhook delivery lifecycle (PENDING → IN_FLIGHT → SUCCEEDED/FAILED)
 * 5. Retry logic with exponential backoff
 * 6. Audit logging for operational observability
 * 7. End-to-end correlation tracking
 *
 * Test Structure:
 * - Setup: Database connection, middleware registration
 * - Test Groups: Middleware, Deduplication, Webhook Delivery, Integration
 * - Teardown: Database cleanup
 *
 * ================================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');

// ISSUE #241: Import Issue #241 components
const { correlationIdMiddleware, getCorrelationId } = require('../src/middleware/correlationId');
const { WebhookDelivery, WEBHOOK_STATUS } = require('../src/models/WebhookDelivery');
const { WebhookSignature } = require('../src/models/WebhookSignature');
const {
  computeFingerprint,
  checkForDuplicate,
  registerSignature,
  getIdempotencyStatus,
  enforceIdempotency
} = require('../src/services/syncDeduplicationService');
const {
  dispatchWebhook,
  isTransientError,
  getRetryDelay,
  RETRY_CONFIG
} = require('../src/services/webhookDeliveryService');
const AuditLog = require('../src/models/AuditLog');

// ISSUE #241: Mock Express app for middleware testing
let app;

/**
 * ISSUE #241: Setup — Initialize test environment
 */
before(async function() {
  this.timeout(10000);

  // ISSUE #241: Ensure MongoDB connection
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/senior-app-test');
  }

  // ISSUE #241: Create Express app with middleware
  const express = require('express');
  app = express();
  app.use(express.json());
  app.use(correlationIdMiddleware());

  // ISSUE #241: Test route for middleware verification
  app.post('/test-sync', (req, res) => {
    res.json({
      correlationId: getCorrelationId(req),
      timestamp: new Date()
    });
  });
});

/**
 * ISSUE #241: Cleanup — Clear test collections after each test
 */
afterEach(async function() {
  // ISSUE #241: Clear test data (but keep structure for speed)
  await WebhookDelivery.deleteMany({});
  await WebhookSignature.deleteMany({});
  await AuditLog.deleteMany({ payload: { $exists: true } });
});

/**
 * ISSUE #241: Cleanup — Close database after all tests
 */
after(async function() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

// ================================================================================
// TEST GROUP 1: CorrelationId Middleware
// ================================================================================

describe('ISSUE #241: CorrelationId Middleware', function() {
  /**
   * ISSUE #241: Test 1.1 — Generate new correlationId when not provided
   */
  it('should generate new correlationId when header not provided', async function() {
    const res = await request(app)
      .post('/test-sync')
      .send({});

    expect(res.status).to.equal(200);
    expect(res.body.correlationId).to.exist;
    expect(res.body.correlationId).to.match(/^corr_\d+_[a-f0-9]+$/);
    expect(res.headers['x-correlation-id']).to.equal(res.body.correlationId);
  });

  /**
   * ISSUE #241: Test 1.2 — Accept correlationId from request header
   */
  it('should accept correlationId from X-Correlation-ID header', async function() {
    const testId = 'corr_test_123_abc';

    const res = await request(app)
      .post('/test-sync')
      .set('X-Correlation-ID', testId)
      .send({});

    expect(res.status).to.equal(200);
    expect(res.body.correlationId).to.equal(testId);
    expect(res.headers['x-correlation-id']).to.equal(testId);
  });

  /**
   * ISSUE #241: Test 1.3 — Propagate correlationId through response headers
   */
  it('should propagate correlationId to response headers', async function() {
    const res = await request(app)
      .post('/test-sync')
      .send({});

    expect(res.headers['x-correlation-id']).to.exist;
    expect(res.headers['x-correlation-id']).to.equal(res.body.correlationId);
  });
});

// ================================================================================
// TEST GROUP 2: Request Deduplication & Idempotency
// ================================================================================

describe('ISSUE #241: Request Deduplication', function() {
  /**
   * ISSUE #241: Test 2.1 — Compute fingerprint deterministically
   */
  it('should compute consistent SHA256 fingerprint', function() {
    const payload = { groupId: 'g123', sprintId: 's456', action: 'SYNC' };
    const key = 'idempotency-key-123';

    const fingerprint1 = computeFingerprint(payload, key);
    const fingerprint2 = computeFingerprint(payload, key);

    expect(fingerprint1).to.equal(fingerprint2);
    expect(fingerprint1).to.match(/^[a-f0-9]{64}$/); // SHA256 is 64 hex chars
  });

  /**
   * ISSUE #241: Test 2.2 — Different payloads produce different fingerprints
   */
  it('should produce different fingerprints for different payloads', function() {
    const key = 'same-key';
    const payload1 = { action: 'SYNC' };
    const payload2 = { action: 'DELETE' };

    const fingerprint1 = computeFingerprint(payload1, key);
    const fingerprint2 = computeFingerprint(payload2, key);

    expect(fingerprint1).to.not.equal(fingerprint2);
  });

  /**
   * ISSUE #241: Test 2.3 — Register and detect duplicate signatures
   */
  it('should detect duplicate requests by fingerprint', async function() {
    const payload = { groupId: 'g123', sprintId: 's456' };
    const idempotencyKey = 'key-123';
    const fingerprint = computeFingerprint(payload, idempotencyKey);

    // ISSUE #241: First request — no duplicate
    const duplicate1 = await checkForDuplicate(fingerprint, idempotencyKey);
    expect(duplicate1).to.be.null;

    // ISSUE #241: Register signature
    const webhookId = 'wh_test_123';
    await registerSignature({
      fingerprint,
      idempotencyKey,
      webhookId,
      context: { endpoint: '/test', method: 'POST' }
    });

    // ISSUE #241: Second request — should detect duplicate
    const duplicate2 = await checkForDuplicate(fingerprint, idempotencyKey);
    expect(duplicate2).to.exist;
    expect(duplicate2.isDuplicate).to.be.true;
    expect(duplicate2.webhookId).to.equal(webhookId);
  });

  /**
   * ISSUE #241: Test 2.4 — Track replay count
   */
  it('should increment replay count on duplicate detection', async function() {
    const payload = { groupId: 'g123' };
    const idempotencyKey = 'key-456';
    const fingerprint = computeFingerprint(payload, idempotencyKey);
    const webhookId = 'wh_test_456';

    // ISSUE #241: Register initial signature
    await registerSignature({
      fingerprint,
      idempotencyKey,
      webhookId,
      context: { endpoint: '/test', method: 'POST' }
    });

    // ISSUE #241: First replay detection
    let duplicate = await checkForDuplicate(fingerprint, idempotencyKey);
    expect(duplicate.replayCount).to.equal(1);

    // ISSUE #241: Second replay detection
    duplicate = await checkForDuplicate(fingerprint, idempotencyKey);
    expect(duplicate.replayCount).to.equal(2);

    // ISSUE #241: Third replay detection
    duplicate = await checkForDuplicate(fingerprint, idempotencyKey);
    expect(duplicate.replayCount).to.equal(3);
  });

  /**
   * ISSUE #241: Test 2.5 — Expired signatures are not detected as duplicates
   */
  it('should treat expired signatures as new requests', async function() {
    const payload = { groupId: 'g123' };
    const idempotencyKey = 'key-expired';
    const fingerprint = computeFingerprint(payload, idempotencyKey);

    // ISSUE #241: Register signature with expired time
    const sig = new WebhookSignature({
      idempotencyKey,
      fingerprint,
      webhookId: 'wh_expired',
      expiresAt: new Date(Date.now() - 1000) // Expired 1 second ago
    });
    await sig.save();

    // ISSUE #241: Query should return null (signature expired)
    const duplicate = await checkForDuplicate(fingerprint, idempotencyKey);
    expect(duplicate).to.be.null;
  });
});

// ================================================================================
// TEST GROUP 3: Webhook Delivery Lifecycle
// ================================================================================

describe('ISSUE #241: Webhook Delivery', function() {
  /**
   * ISSUE #241: Test 3.1 — Create webhook delivery with correct status
   */
  it('should create webhook in PENDING status', async function() {
    const webhook = await dispatchWebhook({
      idempotencyKey: 'key-wh-1',
      fingerprint: computeFingerprint({}, 'key-wh-1'),
      targetService: 'GitHub',
      payload: { action: 'SYNC' },
      correlationId: 'corr_test_1',
      context: { groupId: 'g123', sprintId: 's456' }
    });

    expect(webhook.status).to.equal(WEBHOOK_STATUS.PENDING);
    expect(webhook.webhookId).to.exist;
    expect(webhook.retryCount).to.equal(0);
  });

  /**
   * ISSUE #241: Test 3.2 — Mark webhook as succeeded
   */
  it('should mark webhook as SUCCEEDED with response', async function() {
    const webhook = new WebhookDelivery({
      idempotencyKey: 'key-wh-2',
      fingerprint: computeFingerprint({}, 'key-wh-2'),
      targetService: 'JIRA',
      payload: {},
      correlationId: 'corr_test_2',
      status: WEBHOOK_STATUS.IN_FLIGHT
    });
    await webhook.save();

    // ISSUE #241: Mark as succeeded
    const response = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { result: 'OK' }
    };
    await webhook.markSucceeded(response);

    // ISSUE #241: Verify state
    expect(webhook.status).to.equal(WEBHOOK_STATUS.SUCCEEDED);
    expect(webhook.response.statusCode).to.equal(200);
    expect(webhook.events).to.have.lengthOf.at.least(1);
  });

  /**
   * ISSUE #241: Test 3.3 — Determine transient vs permanent errors
   */
  it('should identify transient errors for retry', function() {
    const transientError = new Error('Connection timeout');
    transientError.code = 'ETIMEDOUT';

    const permanentError = new Error('Invalid credentials');

    expect(isTransientError(transientError, null)).to.be.true;
    expect(isTransientError(permanentError, 401)).to.be.false; // 401 is auth error
    expect(isTransientError(null, 503)).to.be.true; // 503 Service Unavailable is transient
    expect(isTransientError(null, 404)).to.be.false; // 404 Not Found is not transient
  });

  /**
   * ISSUE #241: Test 3.4 — Calculate exponential backoff delays
   */
  it('should calculate exponential backoff delays', function() {
    // ISSUE #241: Exponential backoff: baseDelay * 2^retryCount
    const delay0 = getRetryDelay(0);
    const delay1 = getRetryDelay(1);
    const delay2 = getRetryDelay(2);

    // ISSUE #241: Should roughly follow: 100ms, 200ms, 400ms (with jitter)
    expect(delay0).to.be.within(80, 120);
    expect(delay1).to.be.within(170, 230);
    expect(delay2).to.be.within(350, 450);

    // ISSUE #241: Each should be longer than previous
    expect(delay1).to.be.greaterThan(delay0);
    expect(delay2).to.be.greaterThan(delay1);
  });

  /**
   * ISSUE #241: Test 3.5 — Cannot retry after max attempts
   */
  it('should prevent retry after max attempts exceeded', function() {
    const webhook = new WebhookDelivery({
      retryCount: 3,
      status: WEBHOOK_STATUS.IN_FLIGHT
    });

    expect(webhook.canRetry()).to.be.false;
  });

  /**
   * ISSUE #241: Test 3.6 — Can retry with remaining attempts
   */
  it('should allow retry with remaining attempts', function() {
    const webhook = new WebhookDelivery({
      retryCount: 1,
      status: WEBHOOK_STATUS.PENDING
    });

    expect(webhook.canRetry()).to.be.true;
  });
});

// ================================================================================
// TEST GROUP 4: Audit Logging for Operational Observability
// ================================================================================

describe('ISSUE #241: Audit Logging', function() {
  /**
   * ISSUE #241: Test 4.1 — Log webhook delivery initiation
   */
  it('should create audit log for WEBHOOK_DELIVERY_INITIATED', async function() {
    const correlationId = 'corr_audit_1';

    await AuditLog.create({
      action: 'WEBHOOK_DELIVERY_INITIATED',
      payload: {
        webhookId: 'wh_123',
        correlationId,
        targetService: 'GitHub'
      }
    });

    const audit = await AuditLog.findOne({
      action: 'WEBHOOK_DELIVERY_INITIATED'
    });

    expect(audit).to.exist;
    expect(audit.payload.correlationId).to.equal(correlationId);
  });

  /**
   * ISSUE #241: Test 4.2 — Log duplicate detection
   */
  it('should create audit log for DUPLICATE_REQUEST_DETECTED', async function() {
    const correlationId = 'corr_audit_2';

    await AuditLog.create({
      action: 'DUPLICATE_REQUEST_DETECTED',
      payload: {
        correlationId,
        idempotencyKey: 'key-dup',
        replayCount: 2
      }
    });

    const audit = await AuditLog.findOne({
      action: 'DUPLICATE_REQUEST_DETECTED'
    });

    expect(audit).to.exist;
    expect(audit.payload.replayCount).to.equal(2);
  });

  /**
   * ISSUE #241: Test 4.3 — Query audit logs by correlationId
   */
  it('should find all audit logs for a correlationId', async function() {
    const correlationId = 'corr_audit_3';

    // ISSUE #241: Create multiple related audit logs
    await AuditLog.create({
      action: 'WEBHOOK_DELIVERY_INITIATED',
      payload: { correlationId }
    });
    await AuditLog.create({
      action: 'WEBHOOK_DELIVERY_SUCCEEDED',
      payload: { correlationId }
    });
    await AuditLog.create({
      action: 'ATTRIBUTION_RATIO_CHANGED',
      payload: { correlationId }
    });

    // ISSUE #241: Query by correlation
    const audits = await AuditLog.find({ 'payload.correlationId': correlationId });

    expect(audits).to.have.lengthOf(3);
    expect(audits.map(a => a.action)).to.include.members([
      'WEBHOOK_DELIVERY_INITIATED',
      'WEBHOOK_DELIVERY_SUCCEEDED',
      'ATTRIBUTION_RATIO_CHANGED'
    ]);
  });
});

// ================================================================================
// TEST GROUP 5: Integration Tests (End-to-End)
// ================================================================================

describe('ISSUE #241: End-to-End Integration', function() {
  /**
   * ISSUE #241: Test 5.1 — Complete idempotent request flow
   */
  it('should handle idempotent request flow', async function() {
    const idempotencyKey = 'e2e-key-1';
    const payload = { groupId: 'g123', sprintId: 's456', action: 'SYNC' };

    // ISSUE #241: First request
    const status1 = await getIdempotencyStatus({
      headers: { 'idempotency-key': idempotencyKey },
      body: payload
    });

    expect(status1.valid).to.be.true;
    expect(status1.isDuplicate).to.be.false;
    expect(status1.fingerprint).to.exist;

    // ISSUE #241: Register the signature
    await registerSignature({
      fingerprint: status1.fingerprint,
      idempotencyKey,
      webhookId: 'wh_e2e_1',
      context: { endpoint: '/sync', method: 'POST' }
    });

    // ISSUE #241: Second request (replay)
    const status2 = await getIdempotencyStatus({
      headers: { 'idempotency-key': idempotencyKey },
      body: payload
    });

    expect(status2.isDuplicate).to.be.true;
    expect(status2.webhookId).to.equal('wh_e2e_1');
    expect(status2.replayCount).to.equal(1);
  });

  /**
   * ISSUE #241: Test 5.2 — Webhook lifecycle with correlationId tracing
   */
  it('should trace webhook through complete lifecycle with correlationId', async function() {
    const correlationId = 'corr_e2e_lifecycle';
    const idempotencyKey = 'e2e-key-2';

    // ISSUE #241: Create webhook delivery
    const webhook = await dispatchWebhook({
      idempotencyKey,
      fingerprint: computeFingerprint({ action: 'SYNC' }, idempotencyKey),
      targetService: 'GitHub',
      payload: { action: 'SYNC' },
      correlationId,
      context: { groupId: 'g123', sprintId: 's456' }
    });

    expect(webhook.webhookId).to.exist;
    expect(webhook.correlationId).to.equal(correlationId);

    // ISSUE #241: Query by correlationId
    const webhooks = await WebhookDelivery.getByCorrelationId(correlationId);

    expect(webhooks).to.have.lengthOf.at.least(1);
    expect(webhooks[0].webhookId).to.equal(webhook.webhookId);
  });

  /**
   * ISSUE #241: Test 5.3 — Multiple replays maintain single webhook reference
   */
  it('should maintain single webhook reference across multiple replays', async function() {
    const idempotencyKey = 'e2e-key-3';
    const payload = { action: 'SYNC' };
    const fingerprint = computeFingerprint(payload, idempotencyKey);
    const webhookId = 'wh_e2e_3';

    // ISSUE #241: Register initial
    await registerSignature({
      fingerprint,
      idempotencyKey,
      webhookId,
      context: { endpoint: '/sync', method: 'POST' }
    });

    // ISSUE #241: Multiple replays
    for (let i = 0; i < 3; i++) {
      const duplicate = await checkForDuplicate(fingerprint, idempotencyKey);
      expect(duplicate.webhookId).to.equal(webhookId);
      expect(duplicate.replayCount).to.equal(i + 1);
    }

    // ISSUE #241: Verify only one signature stored
    const signatures = await WebhookSignature.find({ fingerprint });
    expect(signatures).to.have.lengthOf(1);
    expect(signatures[0].webhookId).to.equal(webhookId);
  });
});

// ================================================================================
// ISSUE #241: Export for test runner
// ================================================================================

module.exports = {};
