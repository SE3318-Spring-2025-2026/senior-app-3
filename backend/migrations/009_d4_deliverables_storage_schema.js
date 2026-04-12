/**
 * Migration 009: D4 Deliverables Storage Schema Enhancement
 * Adds additional indexes and constraints for deliverable storage optimization
 * Supports DFD Flows f12 (4.5 → D4) and f14 (D4 → D6)
 */

const up = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 009] Enhancing deliverables collection...');

  const collections = await mongoDb.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (!collectionNames.includes('deliverables')) {
    console.log('[Migration 009] deliverables collection does not exist, skipping');
    return;
  }

  // Add compound indexes for common query patterns
  const indexesToCreate = [
    // Query pattern: get all deliverables for a committee by type
    { key: { committeeId: 1, type: 1 }, options: {} },
    // Query pattern: get all deliverables for a group by status
    { key: { groupId: 1, status: 1 }, options: {} },
    // Query pattern: get deliverables by student in a committee
    { key: { committeeId: 1, studentId: 1 }, options: {} },
    // Query pattern: sort recent submissions
    { key: { createdAt: -1 }, options: {} },
  ];

  for (const index of indexesToCreate) {
    try {
      await mongoDb.collection('deliverables').createIndex(index.key, index.options);
      console.log(`[Migration 009] Created index on deliverables: ${JSON.stringify(index.key)}`);
    } catch (error) {
      // Ignore duplicate index errors
      if (!error.message.includes('already exists')) {
        throw error;
      }
      console.log(`[Migration 009] Index already exists: ${JSON.stringify(index.key)}`);
    }
  }

  // Add any field updates if needed (non-destructive only)
  console.log('[Migration 009] Deliverables collection enhancement completed');
};

const down = async (db) => {
  const mongoDb = db.connection.db;
  console.log('[Migration 009] Rolling back deliverables collection enhancements...');

  const collections = await mongoDb.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (!collectionNames.includes('deliverables')) {
    console.log('[Migration 009] deliverables collection does not exist, skipping');
    return;
  }

  // Drop the added indexes
  const indexesToDrop = [
    { committeeId: 1, type: 1 },
    { groupId: 1, status: 1 },
    { committeeId: 1, studentId: 1 },
    { createdAt: -1 },
  ];

  for (const indexKey of indexesToDrop) {
    try {
      await mongoDb.collection('deliverables').dropIndex(indexKey);
      console.log(`[Migration 009] Dropped index on deliverables: ${JSON.stringify(indexKey)}`);
    } catch (error) {
      // Ignore index not found errors
      if (!error.message.includes('does not exist')) {
        throw error;
      }
      console.log(`[Migration 009] Index did not exist: ${JSON.stringify(indexKey)}`);
    }
  }

  console.log('[Migration 009] Deliverables collection rollback completed');
};

module.exports = { name: '009_d4_deliverables_storage_schema', up, down };
