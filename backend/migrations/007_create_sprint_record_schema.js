const mongoose = require('mongoose');

/**
 * Migration 007: Create Sprint Record & Contribution Record Schema (D6 Data Store)
 * 
 * Creates the sprint_records collection for Process 7 (Sprint Tracking).
 * Includes fields for committee assignment and deliverable cross-references.
 * 
 * Collections:
 * - sprint_records (D6): Sprint-level tracking with committee assignment and deliverable references
 * 
 * Indexes:
 * - sprintRecordId (unique)
 * - sprintId
 * - groupId
 * - committeeId
 * - (sprintId, groupId) compound
 * - (committeeId, sprintId) compound
 * - (groupId, status) compound
 */

const up = async () => {
  const db = mongoose.connection.db;

  // Check if collection already exists
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('sprint_records')) {
    console.log('Sprint records collection already exists, skipping creation');
  } else {
    console.log('Creating sprint_records collection...');
    await db.createCollection('sprint_records');

    // Create indexes
    const collection = db.collection('sprint_records');

    // Unique indexes
    await collection.createIndex({ sprintRecordId: 1 }, { unique: true });

    // Standard indexes
    await collection.createIndex({ sprintId: 1 });
    await collection.createIndex({ groupId: 1 });
    await collection.createIndex({ committeeId: 1 });

    // Compound indexes
    await collection.createIndex({ sprintId: 1, groupId: 1 });
    await collection.createIndex({ committeeId: 1, sprintId: 1 });
    await collection.createIndex({ groupId: 1, status: 1 });

    console.log('Sprint records collection created with indexes');
  }
};

const down = async () => {
  const db = mongoose.connection.db;

  // Check if collection exists
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('sprint_records')) {
    console.log('Dropping sprint_records collection...');
    await db.collection('sprint_records').drop();
    console.log('Sprint records collection dropped');
  } else {
    console.log('Sprint records collection does not exist, skipping drop');
  }
};

module.exports = { up, down };
