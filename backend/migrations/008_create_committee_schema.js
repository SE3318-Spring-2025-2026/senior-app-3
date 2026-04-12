const mongoose = require('mongoose');

/**
 * Migration 008: Create Committee Schema (D3 Data Store)
 * 
 * Creates the committees collection for Process 4.0 (Committee Assignment).
 * Stores committee drafts, validated committees, and published committees.
 * 
 * Collections:
 * - committees (D3): Committee assignments and configuration
 * 
 * Indexes:
 * - committeeId (unique)
 * - committeeName (unique)
 * - status
 * - (createdBy, status) compound
 * - (status, publishedAt) compound descending
 * 
 * IDEMPOTENT INDEX PATTERN:
 * Index creation is UNCONDITIONAL (outside collection existence check).
 * This ensures that if a collection exists but indexes were manually dropped
 * or failed to create in a previous partial run, the migration self-heals.
 */

const up = async () => {
  const db = mongoose.connection.db;

  // 1. Ensure collection exists (Non-destructive)
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name);

  if (!collectionNames.includes('committees')) {
    console.log('Creating committees collection...');
    await db.createCollection('committees');
  } else {
    console.log('Committees collection already exists, proceeding with index enforcement');
  }

  // 2. UNCONDITIONAL INDEX CREATION (The Idempotency Fix)
  // We execute these regardless of whether the collection was just created
  // to ensure the DB state matches the architectural spec.
  const collection = db.collection('committees');

  // Unique indexes
  await collection.createIndex({ committeeId: 1 }, { unique: true });
  await collection.createIndex({ committeeName: 1 }, { unique: true });

  // Standard indexes
  await collection.createIndex({ status: 1 });

  // Compound indexes
  await collection.createIndex({ createdBy: 1, status: 1 });
  await collection.createIndex({ status: 1, publishedAt: -1 });

  console.log('D3 Schema: Indices enforced successfully.');
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
