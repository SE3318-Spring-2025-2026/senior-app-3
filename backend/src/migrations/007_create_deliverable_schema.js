'use strict';

/**
 * Migration 007: Create Deliverable and DeliverableStaging collections (D4)
 *
 * Creates both collections with all required indexes for Process 5 (Deliverable Submission).
 *
 * Deliverable (D4):
 *   Fields: deliverableId, groupId, deliverableType, sprintId, submittedBy, description,
 *           filePath, fileSize, fileHash, format, status, version, submittedAt, createdAt, updatedAt
 *   Indexes:
 *     { deliverableId: 1 }                              — unique
 *     { groupId: 1, createdAt: -1 }                    — group timeline queries
 *     { status: 1 }                                    — status filter queries
 *     { groupId: 1, deliverableType: 1, sprintId: 1 }  — version counting
 *
 * DeliverableStaging:
 *   Indexes:
 *     { stagingId: 1 }    — unique
 *     { expiresAt: 1 }    — TTL (auto-delete expired staging records)
 *     { groupId: 1 }      — rate-limit queries
 */

const DELIVERABLE_TYPES = ['proposal', 'statement_of_work', 'demo', 'interim_report', 'final_report'];
const DELIVERABLE_STATUSES = ['accepted', 'under_review', 'awaiting_resubmission', 'evaluated', 'retracted'];

const STAGING_STATUSES = [
  'staging',
  'format_validated',
  'validation_failed',
  'deadline_failed',
  'requirements_validated',
];

/**
 * Idempotent index creation helper — treats "already exists" as success.
 */
const createIndexSafely = async (collection, indexSpec, options, label) => {
  try {
    await collection.createIndex(indexSpec, options);
    console.log(`[Migration 007] Created index ${label}`);
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`[Migration 007] Index ${label} already exists — skipping`);
    } else {
      throw err;
    }
  }
};

const up = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 007] Running — Deliverable + DeliverableStaging schema');

  const existing = await mongoDb.listCollections().toArray();
  const names = new Set(existing.map((c) => c.name));

  // ── Deliverable collection ────────────────────────────────────────────────
  if (!names.has('deliverables')) {
    await mongoDb.createCollection('deliverables', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['deliverableId', 'groupId', 'deliverableType', 'submittedBy', 'filePath', 'fileSize', 'fileHash', 'format', 'status'],
          properties: {
            deliverableId: { bsonType: 'string' },
            groupId: { bsonType: 'string' },
            deliverableType: { bsonType: 'string', enum: DELIVERABLE_TYPES },
            sprintId: { bsonType: ['string', 'null'] },
            submittedBy: { bsonType: 'string' },
            description: { bsonType: ['string', 'null'] },
            filePath: { bsonType: 'string' },
            fileSize: { bsonType: 'number' },
            fileHash: { bsonType: 'string' },
            format: { bsonType: 'string' },
            status: { bsonType: 'string', enum: DELIVERABLE_STATUSES },
            version: { bsonType: 'int' },
            submittedAt: { bsonType: 'date' },
          },
        },
      },
    });
    console.log('[Migration 007] Created deliverables collection');
  } else {
    console.log('[Migration 007] deliverables collection already exists');
  }

  const deliverables = mongoDb.collection('deliverables');
  await createIndexSafely(deliverables, { deliverableId: 1 }, { unique: true }, '{ deliverableId: 1 } UNIQUE');
  await createIndexSafely(deliverables, { groupId: 1, createdAt: -1 }, {}, '{ groupId, createdAt }');
  await createIndexSafely(deliverables, { status: 1 }, {}, '{ status }');
  await createIndexSafely(deliverables, { groupId: 1, deliverableType: 1, sprintId: 1 }, {}, '{ groupId, deliverableType, sprintId }');

  // ── DeliverableStaging collection ────────────────────────────────────────
  if (!names.has('deliverable_stagings')) {
    await mongoDb.createCollection('deliverable_stagings', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['stagingId', 'groupId', 'deliverableType', 'sprintId', 'submittedBy', 'tempFilePath', 'fileSize', 'fileHash', 'mimeType', 'status'],
          properties: {
            stagingId: { bsonType: 'string' },
            groupId: { bsonType: 'string' },
            deliverableType: { bsonType: 'string', enum: DELIVERABLE_TYPES },
            sprintId: { bsonType: 'string' },
            submittedBy: { bsonType: 'string' },
            description: { bsonType: ['string', 'null'] },
            tempFilePath: { bsonType: 'string' },
            fileSize: { bsonType: 'number' },
            fileHash: { bsonType: 'string' },
            mimeType: { bsonType: 'string' },
            status: { bsonType: 'string', enum: STAGING_STATUSES },
            expiresAt: { bsonType: 'date' },
          },
        },
      },
    });
    console.log('[Migration 007] Created deliverable_stagings collection');
  } else {
    console.log('[Migration 007] deliverable_stagings collection already exists');
  }

  const stagings = mongoDb.collection('deliverable_stagings');
  await createIndexSafely(stagings, { stagingId: 1 }, { unique: true }, '{ stagingId: 1 } UNIQUE');
  await createIndexSafely(stagings, { expiresAt: 1 }, { expireAfterSeconds: 0 }, '{ expiresAt } TTL');
  await createIndexSafely(stagings, { groupId: 1 }, {}, '{ groupId }');

  console.log('[Migration 007] Complete');
};

const down = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 007] Rolling back — dropping Deliverable + DeliverableStaging collections');

  const existing = await mongoDb.listCollections().toArray();
  const names = new Set(existing.map((c) => c.name));

  if (names.has('deliverables')) {
    await mongoDb.collection('deliverables').drop();
    console.log('[Migration 007] Dropped deliverables');
  }

  if (names.has('deliverable_stagings')) {
    await mongoDb.collection('deliverable_stagings').drop();
    console.log('[Migration 007] Dropped deliverable_stagings');
  }

  console.log('[Migration 007] Rollback complete');
};

module.exports = { name: '007_create_deliverable_schema', up, down };
