const mongoose = require('mongoose');

/**
 * Migration 009: Create Committee Schema (D3 Data Store)
 * 
 * Creates the committees collection for Process 4.0 (Committee Assignment).
 * 
 * Collections:
 * - committees (D3): Committee assignments and configuration
 * 
 * Indexes:
 * - committeeId (unique)
 * - committeeName (unique)
 * - status
 * - createdBy + status
 * - status + publishedAt
 */

const up = async () => {
  const db = mongoose.connection.db;

  // Check if collection already exists
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('committees')) {
    console.log('Committees collection already exists, skipping creation');
  } else {
    console.log('Creating committees collection...');
    await db.createCollection('committees');

    // Create indexes
    const collection = db.collection('committees');

    // Unique indexes
    await collection.createIndex({ committeeId: 1 }, { unique: true });
    await collection.createIndex({ committeeName: 1 }, { unique: true });

    // Standard indexes
    await collection.createIndex({ status: 1 });
    await collection.createIndex({ createdBy: 1, status: 1 });
    await collection.createIndex({ status: 1, publishedAt: -1 });

    console.log('Committees collection created with indexes');
  }
};

const down = async () => {
  const db = mongoose.connection.db;

  // Check if collection exists
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (collectionNames.includes('committees')) {
    console.log('Dropping committees collection...');
    await db.collection('committees').drop();
    console.log('Committees collection dropped');
  } else {
    console.log('Committees collection does not exist, skipping drop');
  }
};

module.exports = { up, down };
