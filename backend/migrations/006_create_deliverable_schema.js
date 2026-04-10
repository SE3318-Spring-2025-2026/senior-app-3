const mongoose = require('mongoose');

/**
 * Migration 006: Create Deliverable Schema (D4)
 * Creates deliverables collection for storing committee evaluation submissions
 */

const up = async (db) => {
  console.log('[Migration 006] Creating deliverables collection...');

  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('deliverables')) {
    console.log('[Migration 006] deliverables collection already exists, skipping');
    return;
  }

  // Create collection with schema validation
  await db.createCollection('deliverables', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['deliverableId', 'committeeId', 'groupId', 'studentId', 'type', 'storageRef', 'status'],
        properties: {
          deliverableId: { bsonType: 'string', description: 'Unique deliverable identifier' },
          committeeId: { bsonType: 'string', description: 'Committee ID' },
          groupId: { bsonType: 'string', description: 'Group ID' },
          studentId: { bsonType: 'string', description: 'Student ID who submitted' },
          type: {
            bsonType: 'string',
            enum: ['proposal', 'statement-of-work', 'demonstration'],
            description: 'Deliverable type',
          },
          submittedAt: { bsonType: 'date', description: 'Submission timestamp' },
          storageRef: { bsonType: 'string', description: 'Reference to storage location' },
          status: {
            bsonType: 'string',
            enum: ['submitted', 'reviewed', 'accepted', 'rejected'],
            description: 'Deliverable status',
          },
          feedback: { bsonType: 'string', description: 'Review feedback' },
          reviewedBy: { bsonType: 'string', description: 'Reviewer user ID' },
          reviewedAt: { bsonType: 'date', description: 'Review timestamp' },
          createdAt: { bsonType: 'date', description: 'Record creation timestamp' },
          updatedAt: { bsonType: 'date', description: 'Last update timestamp' },
        },
      },
    },
  });

  console.log('[Migration 006] deliverables collection created');

  // Create indexes
  const indexesToCreate = [
    { key: { deliverableId: 1 }, options: { unique: true } },
    { key: { committeeId: 1 }, options: {} },
    { key: { groupId: 1 }, options: {} },
    { key: { type: 1 }, options: {} },
    { key: { committeeId: 1, groupId: 1 }, options: {} },
    { key: { groupId: 1, type: 1 }, options: {} },
    { key: { submittedAt: -1 }, options: {} },
  ];

  for (const index of indexesToCreate) {
    await db.collection('deliverables').createIndex(index.key, index.options);
    console.log(`[Migration 006] Created index on deliverables: ${JSON.stringify(index.key)}`);
  }
};

const down = async (db) => {
  console.log('[Migration 006] Dropping deliverables collection...');

  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('deliverables')) {
    await db.collection('deliverables').drop();
    console.log('[Migration 006] deliverables collection dropped');
  } else {
    console.log('[Migration 006] deliverables collection does not exist, skipping');
  }
};

module.exports = { up, down };
