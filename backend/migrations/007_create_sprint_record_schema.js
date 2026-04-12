/**
 * Migration 007: Create Sprint Record Schema (D6)
 * Phase 1: collection creation (conditional)
 * Phase 2: indexes (unconditional, idempotent)
 */

const createIndexSafely = async (collection, indexSpec, options, description) => {
  try {
    await collection.createIndex(indexSpec, options);
    console.log(`[Migration 007] ✅ ${description}`);
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`[Migration 007] ℹ️  ${description} (already exists)`);
    } else {
      throw err;
    }
  }
};

const up = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 007] sprint_records (Phase 1 + Phase 2)...');

  const collections = await mongoDb.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (!collectionNames.includes('sprint_records')) {
    await mongoDb.createCollection('sprint_records', {
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
  } else {
    console.log('[Migration 007] sprint_records collection already exists');
  }

  const col = mongoDb.collection('sprint_records');
  await createIndexSafely(col, { sprintRecordId: 1 }, { unique: true }, 'sprintRecordId unique');
  await createIndexSafely(col, { sprintId: 1 }, {}, 'sprintId');
  await createIndexSafely(col, { groupId: 1 }, {}, 'groupId');
  await createIndexSafely(col, { committeeId: 1 }, {}, 'committeeId');
  await createIndexSafely(col, { sprintId: 1, groupId: 1 }, {}, 'sprintId+groupId');
  await createIndexSafely(col, { committeeId: 1, sprintId: 1 }, {}, 'committeeId+sprintId');
  await createIndexSafely(col, { groupId: 1, status: 1 }, {}, 'groupId+status');
};

const down = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 007] Dropping sprint_records collection...');

  const collections = await mongoDb.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('sprint_records')) {
    await mongoDb.collection('sprint_records').drop();
    console.log('[Migration 007] sprint_records collection dropped');
  } else {
    console.log('[Migration 007] sprint_records collection does not exist, skipping');
  }
};

module.exports = { name: '007_create_sprint_record_schema', up, down };
