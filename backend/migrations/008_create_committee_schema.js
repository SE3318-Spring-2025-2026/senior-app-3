/**
 * Migration 008: Create Committee Schema (D3)
 * Phase 1: collection creation (conditional)
 * Phase 2: indexes (unconditional, idempotent)
 */

const createIndexSafely = async (collection, indexSpec, options, description) => {
  try {
    await collection.createIndex(indexSpec, options);
    console.log(`[Migration 008] ✅ ${description}`);
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`[Migration 008] ℹ️  ${description} (already exists)`);
    } else {
      throw err;
    }
  }
};

const up = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 008] committees (Phase 1 + Phase 2)...');

  const collections = await mongoDb.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (!collectionNames.includes('committees')) {
    await mongoDb.createCollection('committees', {
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
  } else {
    console.log('[Migration 008] committees collection already exists');
  }

  const col = mongoDb.collection('committees');
  await createIndexSafely(col, { committeeId: 1 }, { unique: true }, 'committeeId unique');
  await createIndexSafely(col, { committeeName: 1 }, { unique: true }, 'committeeName unique');
  await createIndexSafely(col, { status: 1 }, {}, 'status');
  await createIndexSafely(col, { createdBy: 1, status: 1 }, {}, 'createdBy+status');
  await createIndexSafely(col, { status: 1, publishedAt: -1 }, {}, 'status+publishedAt');
};

const down = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 008] Dropping committees collection...');

  const collections = await mongoDb.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('committees')) {
    await mongoDb.collection('committees').drop();
    console.log('[Migration 008] committees collection dropped');
  } else {
    console.log('[Migration 008] committees collection does not exist, skipping');
  }
};

module.exports = { name: '008_create_committee_schema', up, down };
