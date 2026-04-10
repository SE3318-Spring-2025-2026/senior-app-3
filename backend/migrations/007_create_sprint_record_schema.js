const mongoose = require('mongoose');

/**
 * Migration 007: Create Sprint Record Schema (D6)
 * Creates sprint_records collection for tracking sprint-level deliverable submissions
 */

const up = async (db) => {
  console.log('[Migration 007] Creating sprint_records collection...');

  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('sprint_records')) {
    console.log('[Migration 007] sprint_records collection already exists, skipping');
    return;
  }

  // Create collection with schema validation
  await db.createCollection('sprint_records', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['sprintRecordId', 'sprintId', 'groupId', 'status'],
        properties: {
          sprintRecordId: { bsonType: 'string', description: 'Unique sprint record identifier' },
          sprintId: { bsonType: 'string', description: 'Sprint ID' },
          groupId: { bsonType: 'string', description: 'Group ID' },
          committeeId: { bsonType: 'string', description: 'Committee ID (if assigned)' },
          committeeAssignedAt: { bsonType: 'date', description: 'When committee was assigned' },
          deliverableRefs: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              properties: {
                deliverableId: { bsonType: 'string', description: 'Reference to D4 deliverable' },
                type: {
                  bsonType: 'string',
                  enum: ['proposal', 'statement-of-work', 'demonstration'],
                },
                submittedAt: { bsonType: 'date', description: 'When deliverable was submitted' },
              },
            },
            description: 'Array of deliverable references',
          },
          status: {
            bsonType: 'string',
            enum: ['pending', 'in_progress', 'submitted', 'reviewed', 'completed'],
            description: 'Sprint record status',
          },
          createdAt: { bsonType: 'date', description: 'Record creation timestamp' },
          updatedAt: { bsonType: 'date', description: 'Last update timestamp' },
        },
      },
    },
  });

  console.log('[Migration 007] sprint_records collection created');

  // Create indexes
  const indexesToCreate = [
    { key: { sprintRecordId: 1 }, options: { unique: true } },
    { key: { sprintId: 1 }, options: {} },
    { key: { groupId: 1 }, options: {} },
    { key: { committeeId: 1 }, options: {} },
    { key: { sprintId: 1, groupId: 1 }, options: {} },
    { key: { committeeId: 1, sprintId: 1 }, options: {} },
    { key: { groupId: 1, status: 1 }, options: {} },
  ];

  for (const index of indexesToCreate) {
    await db.collection('sprint_records').createIndex(index.key, index.options);
    console.log(`[Migration 007] Created index on sprint_records: ${JSON.stringify(index.key)}`);
  }
};

const down = async (db) => {
  console.log('[Migration 007] Dropping sprint_records collection...');

  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('sprint_records')) {
    await db.collection('sprint_records').drop();
    console.log('[Migration 007] sprint_records collection dropped');
  } else {
    console.log('[Migration 007] sprint_records collection does not exist, skipping');
  }
};

module.exports = { up, down };
