/**
 * ================================================================================
 * ISSUE #241: Migration — Create Webhook Delivery Infrastructure
 * ================================================================================
 *
 * Purpose:
 * Create MongoDB collections and indexes for webhook delivery tracking,
 * idempotency enforcement, and request deduplication.
 *
 * Collections Created:
 * 1. WebhookDelivery — Track webhook job lifecycle with retry history
 * 2. WebhookSignature — Store request fingerprints for duplicate detection
 *
 * Indexes Created:
 * - WebhookDelivery: 4 compound indexes for efficient queries
 * - WebhookSignature: 4 indexes for fast duplicate detection + TTL
 *
 * ================================================================================
 */

module.exports = {
  // ISSUE #241: Migration ID (timestamp_name format)
  id: '013_create_webhook_infrastructure',

  // ISSUE #241: Function to execute on migration UP (apply changes)
  up: async (db) => {
    console.log('[ISSUE #241] Creating webhook infrastructure collections...');

    // =========================================================================
    // ISSUE #241: Create WebhookDelivery Collection
    // =========================================================================
    // This collection tracks each webhook delivery job with retry history
    // and complete request/response capture for debugging.

    try {
      await db.createCollection('webhookdeliveries', {
        validator: {
          $jsonSchema: {
            // ISSUE #241: Define schema validation for safety
            bsonType: 'object',
            required: [
              'webhookId',
              'idempotencyKey',
              'fingerprint',
              'status',
              'correlationId',
              'targetService',
              'payload'
            ],
            properties: {
              _id: { bsonType: 'objectId' },
              webhookId: { bsonType: 'string', description: 'Unique webhook ID' },
              idempotencyKey: { bsonType: 'string', description: 'Client idempotency key' },
              fingerprint: { bsonType: 'string', description: 'SHA256 fingerprint of request' },
              status: {
                enum: ['PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED'],
                description: 'Webhook delivery status'
              },
              correlationId: { bsonType: 'string', description: 'Request tracing ID' },
              targetService: {
                enum: ['JIRA', 'GitHub', 'Notification'],
                description: 'Target service for this webhook'
              },
              payload: { bsonType: 'object', description: 'Request payload' },
              response: { bsonType: ['object', 'null'], description: 'External service response' },
              retryCount: { bsonType: 'int', description: 'Number of retry attempts' },
              lastError: { bsonType: ['object', 'null'], description: 'Error from last attempt' },
              scheduledRetries: {
                bsonType: 'array',
                items: { bsonType: 'date' },
                description: 'Scheduled retry timestamps'
              },
              context: { bsonType: ['object', 'null'], description: 'Operation context' },
              events: {
                bsonType: 'array',
                items: { bsonType: 'object' },
                description: 'Audit trail of delivery lifecycle'
              },
              createdAt: { bsonType: 'date' },
              updatedAt: { bsonType: 'date' }
            }
          }
        }
      });

      console.log('[ISSUE #241] ✓ WebhookDelivery collection created');
    } catch (error) {
      if (error.codeName !== 'NamespaceExists') {
        throw error;
      }
      console.log('[ISSUE #241] ✓ WebhookDelivery collection already exists');
    }

    // =========================================================================
    // ISSUE #241: Create WebhookDelivery Indexes
    // =========================================================================

    // ISSUE #241: Index 1 — Query webhooks by status and creation time
    // Use case: Background job to find PENDING/IN_FLIGHT webhooks needing retry
    await db.collection('webhookdeliveries').createIndex(
      { status: 1, createdAt: 1 },
      { name: 'idx_webhook_status_created' }
    );
    console.log('[ISSUE #241] ✓ Index: status + createdAt');

    // ISSUE #241: Index 2 — Query webhooks by idempotencyKey and fingerprint
    // Use case: Check if request is duplicate for idempotency enforcement
    await db.collection('webhookdeliveries').createIndex(
      { idempotencyKey: 1, fingerprint: 1 },
      { name: 'idx_webhook_idempotency' }
    );
    console.log('[ISSUE #241] ✓ Index: idempotencyKey + fingerprint');

    // ISSUE #241: Index 3 — Query webhooks by correlationId for tracing
    // Use case: Operator debugging — find all webhooks triggered by single request
    await db.collection('webhookdeliveries').createIndex(
      { correlationId: 1, createdAt: -1 },
      { name: 'idx_webhook_correlation' }
    );
    console.log('[ISSUE #241] ✓ Index: correlationId + createdAt');

    // ISSUE #241: Index 4 — Query webhooks by context for analytics
    // Use case: Find all webhooks for specific sprint/group
    await db.collection('webhookdeliveries').createIndex(
      { 'context.groupId': 1, 'context.sprintId': 1, createdAt: -1 },
      { name: 'idx_webhook_context' }
    );
    console.log('[ISSUE #241] ✓ Index: context.groupId + context.sprintId + createdAt');

    // =========================================================================
    // ISSUE #241: Create WebhookSignature Collection
    // =========================================================================
    // This collection stores request fingerprints for duplicate detection.
    // Implements RFC 7231 idempotency pattern for safe retries.

    try {
      await db.createCollection('webhooksignatures', {
        validator: {
          $jsonSchema: {
            // ISSUE #241: Define schema validation for safety
            bsonType: 'object',
            required: [
              'idempotencyKey',
              'fingerprint',
              'webhookId',
              'expiresAt'
            ],
            properties: {
              _id: { bsonType: 'objectId' },
              idempotencyKey: { bsonType: 'string', description: 'Client idempotency key' },
              fingerprint: { bsonType: 'string', description: 'SHA256 hash (unique)' },
              webhookId: { bsonType: 'string', description: 'Reference to WebhookDelivery' },
              expiresAt: { bsonType: 'date', description: 'Signature expiration time' },
              firstSeenAt: { bsonType: 'date', description: 'First occurrence timestamp' },
              replayCount: { bsonType: 'int', description: 'Number of replays' },
              context: { bsonType: ['object', 'null'], description: 'Request context' },
              enforcement: { bsonType: ['object', 'null'], description: 'Enforcement metadata' }
            }
          }
        }
      });

      console.log('[ISSUE #241] ✓ WebhookSignature collection created');
    } catch (error) {
      if (error.codeName !== 'NamespaceExists') {
        throw error;
      }
      console.log('[ISSUE #241] ✓ WebhookSignature collection already exists');
    }

    // =========================================================================
    // ISSUE #241: Create WebhookSignature Indexes
    // =========================================================================

    // ISSUE #241: Index 1 — Fast duplicate detection by idempotencyKey
    await db.collection('webhooksignatures').createIndex(
      { idempotencyKey: 1, createdAt: -1 },
      { name: 'idx_signature_idempotency_key' }
    );
    console.log('[ISSUE #241] ✓ Index: idempotencyKey + createdAt');

    // ISSUE #241: Index 2 — Fast fingerprint lookup (unique constraint)
    await db.collection('webhooksignatures').createIndex(
      { fingerprint: 1 },
      { name: 'idx_signature_fingerprint', unique: true }
    );
    console.log('[ISSUE #241] ✓ Index: fingerprint (UNIQUE)');

    // ISSUE #241: Index 3 — Find signatures by context (endpoint + method)
    await db.collection('webhooksignatures').createIndex(
      { 'context.endpoint': 1, 'context.method': 1, firstSeenAt: -1 },
      { name: 'idx_signature_context' }
    );
    console.log('[ISSUE #241] ✓ Index: context.endpoint + context.method + firstSeenAt');

    // ISSUE #241: Index 4 — High-replay detection (for anomaly analysis)
    await db.collection('webhooksignatures').createIndex(
      { replayCount: -1, firstSeenAt: -1 },
      { name: 'idx_signature_replay_count' }
    );
    console.log('[ISSUE #241] ✓ Index: replayCount + firstSeenAt');

    // =========================================================================
    // ISSUE #241: Create TTL Index on WebhookSignature
    // =========================================================================
    // ISSUE #241: Automatically delete expired signatures after 24 hours
    // This prevents collection from growing unbounded.
    // MongoDB will periodically scan and delete documents where expiresAt <= now()

    await db.collection('webhooksignatures').createIndex(
      { expiresAt: 1 },
      { name: 'idx_signature_expires_ttl', expireAfterSeconds: 0 }
    );
    console.log('[ISSUE #241] ✓ TTL Index: expiresAt (auto-delete)');

    console.log('[ISSUE #241] ✓ Migration UP complete — Webhook infrastructure ready');
  },

  // ISSUE #241: Function to execute on migration DOWN (rollback changes)
  down: async (db) => {
    console.log('[ISSUE #241] Rolling back webhook infrastructure...');

    // ISSUE #241: Drop WebhookDelivery collection and indexes
    try {
      await db.collection('webhookdeliveries').dropIndexes();
      await db.dropCollection('webhookdeliveries');
      console.log('[ISSUE #241] ✓ WebhookDelivery collection dropped');
    } catch (error) {
      if (error.codeName !== 'NamespaceNotFound') {
        console.warn('[ISSUE #241] Warning dropping webhookdeliveries:', error.message);
      }
    }

    // ISSUE #241: Drop WebhookSignature collection and indexes
    try {
      await db.collection('webhooksignatures').dropIndexes();
      await db.dropCollection('webhooksignatures');
      console.log('[ISSUE #241] ✓ WebhookSignature collection dropped');
    } catch (error) {
      if (error.codeName !== 'NamespaceNotFound') {
        console.warn('[ISSUE #241] Warning dropping webhooksignatures:', error.message);
      }
    }

    console.log('[ISSUE #241] ✓ Migration DOWN complete — Webhook infrastructure rolled back');
  }
};
