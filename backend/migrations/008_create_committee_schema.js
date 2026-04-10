const mongoose = require('mongoose');

/**
 * Migration 008: Create Committee Schema (D3)
 * Creates committees collection for storing committee configuration and lifecycle
 */

const up = async (db) => {
  console.log('[Migration 008] Creating committees collection...');

  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('committees')) {
    console.log('[Migration 008] committees collection already exists, skipping');
    return;
  }

  // Create collection with schema validation
  await db.createCollection('committees', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['committeeId', 'committeeName', 'status', 'createdBy'],
        properties: {
          committeeId: { bsonType: 'string', description: 'Unique committee identifier' },
          committeeName: { bsonType: 'string', description: 'Committee name' },
          description: { bsonType: 'string', description: 'Committee description' },
          advisorIds: {
            bsonType: 'array',
            items: { bsonType: 'string' },
            description: 'Array of advisor user IDs',
          },
          juryIds: {
            bsonType: 'array',
            items: { bsonType: 'string' },
            description: 'Array of jury member user IDs',
          },
          status: {
            bsonType: 'string',
            enum: ['draft', 'validated', 'published'],
            description: 'Committee lifecycle status',
          },
          createdBy: { bsonType: 'string', description: 'Coordinator user ID' },
          publishedAt: { bsonType: 'date', description: 'When committee was published' },
          publishedBy: { bsonType: 'string', description: 'User ID who published' },
          validatedAt: { bsonType: 'date', description: 'When committee was validated' },
          validatedBy: { bsonType: 'string', description: 'User ID who validated' },
          createdAt: { bsonType: 'date', description: 'Record creation timestamp' },
          updatedAt: { bsonType: 'date', description: 'Last update timestamp' },
        },
      },
    },
  });

  console.log('[Migration 008] committees collection created');

  // Create indexes
  const indexesToCreate = [
    { key: { committeeId: 1 }, options: { unique: true } },
    { key: { committeeName: 1 }, options: { unique: true } },
    { key: { status: 1 }, options: {} },
    { key: { createdBy: 1, status: 1 }, options: {} },
    { key: { status: 1, publishedAt: -1 }, options: {} },
  ];

  for (const index of indexesToCreate) {
    await db.collection('committees').createIndex(index.key, index.options);
    console.log(`[Migration 008] Created index on committees: ${JSON.stringify(index.key)}`);
  }
};

const down = async (db) => {
  console.log('[Migration 008] Dropping committees collection...');

  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('committees')) {
    await db.collection('committees').drop();
    console.log('[Migration 008] committees collection dropped');
  } else {
    console.log('[Migration 008] committees collection does not exist, skipping');
  }
};

module.exports = { up, down };
