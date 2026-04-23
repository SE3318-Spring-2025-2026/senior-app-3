const mongoose = require('mongoose');

/**
 * Migration 010: Create Review and Comment collections (Process 6)
 *
 * Collections:
 * - reviews  : committee review assignments per deliverable
 * - comments : unified comment / reply threads per deliverable
 *
 * Does NOT modify the deliverables collection.
 */

const up = async () => {
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name);

  // ── reviews ────────────────────────────────────────────────────────────────
  if (names.includes('reviews')) {
    console.log('reviews collection already exists, skipping creation');
  } else {
    console.log('Creating reviews collection...');
    await db.createCollection('reviews');

    const reviews = db.collection('reviews');
    await reviews.createIndex({ reviewId: 1 }, { unique: true });
    await reviews.createIndex({ deliverableId: 1 }, { unique: true });
    await reviews.createIndex({ status: 1 });
    await reviews.createIndex({ groupId: 1 });

    console.log('reviews collection created with indexes');
  }

  // ── comments ───────────────────────────────────────────────────────────────
  if (names.includes('comments')) {
    console.log('comments collection already exists, skipping creation');
  } else {
    console.log('Creating comments collection...');
    await db.createCollection('comments');

    const comments = db.collection('comments');
    await comments.createIndex({ commentId: 1 }, { unique: true });
    await comments.createIndex({ deliverableId: 1, createdAt: 1 });
    await comments.createIndex({ deliverableId: 1, status: 1 });

    console.log('comments collection created with indexes');
  }
};

const down = async () => {
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name);

  if (names.includes('reviews')) {
    console.log('Dropping reviews collection...');
    await db.collection('reviews').drop();
    console.log('reviews collection dropped');
  }

  if (names.includes('comments')) {
    console.log('Dropping comments collection...');
    await db.collection('comments').drop();
    console.log('comments collection dropped');
  }
};

module.exports = { name: '010_create_review_schema', up, down };
