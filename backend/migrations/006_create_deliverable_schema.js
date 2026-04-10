const mongoose = require('mongoose');

/**
 * Migration 006: Create Deliverable Schema (D4 Data Store)
 * 
 * Creates the deliverables collection for Process 4.5 (Deliverable Submission).
 * 
 * Collections:
 * - deliverables (D4): Student project deliverables submitted for committee evaluation
 * 
 * Indexes:
 * - deliverableId (unique)
 * - committeeId
 * - groupId
 * - type
 * - (committeeId, groupId) compound
 * - (groupId, type) compound
 * - submittedAt descending
 */

const up = async () => {
  const db = mongoose.connection.db;

  // Check if collection already exists
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('deliverables')) {
    console.log('Deliverables collection already exists, skipping creation');
  } else {
    console.log('Creating deliverables collection...');
    await db.createCollection('deliverables');

    // Create indexes
    const collection = db.collection('deliverables');

    // Unique indexes
    await collection.createIndex({ deliverableId: 1 }, { unique: true });

    // Standard indexes
    await collection.createIndex({ committeeId: 1 });
    await collection.createIndex({ groupId: 1 });
    await collection.createIndex({ type: 1 });

    // Compound indexes
    await collection.createIndex({ committeeId: 1, groupId: 1 });
    await collection.createIndex({ groupId: 1, type: 1 });
    await collection.createIndex({ submittedAt: -1 });

    console.log('Deliverables collection created with indexes');
  }
};

const down = async () => {
  const db = mongoose.connection.db;

  // Check if collection exists
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('deliverables')) {
    console.log('Dropping deliverables collection...');
    await db.collection('deliverables').drop();
    console.log('Deliverables collection dropped');
  } else {
    console.log('Deliverables collection does not exist, skipping drop');
  }
};

module.exports = { up, down };
