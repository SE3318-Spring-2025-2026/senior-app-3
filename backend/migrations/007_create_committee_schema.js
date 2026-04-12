/**
 * Migration: 007_create_committee_schema
 *
 * Creates D3 committees collection and ensures index strategy for Issue #78:
 * - committeeId (unique)
 * - committeeName (unique)
 * - status
 */

module.exports = {
  name: '007_create_committee_schema',

  up: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'committees' }).toArray();
    if (collections.length === 0) {
      await conn.createCollection('committees');
      console.log('[MIGRATION] Created committees collection');
    } else {
      console.log('[MIGRATION] committees collection already exists, skipping creation');
    }

    const coll = conn.collection('committees');

    await coll.createIndex({ committeeId: 1 }, { unique: true });
    console.log('[MIGRATION] Ensured index: committees.committeeId (unique)');

    await coll.createIndex({ committeeName: 1 }, { unique: true });
    console.log('[MIGRATION] Ensured index: committees.committeeName (unique)');

    await coll.createIndex({ status: 1 });
    console.log('[MIGRATION] Ensured index: committees.status');
  },

  down: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'committees' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] committees collection does not exist, skipping rollback');
      return;
    }

    const coll = conn.collection('committees');

    try {
      await coll.dropIndex('committeeId_1');
    } catch (err) {
      if (!err.message.includes('index not found')) throw err;
    }

    try {
      await coll.dropIndex('committeeName_1');
    } catch (err) {
      if (!err.message.includes('index not found')) throw err;
    }

    try {
      await coll.dropIndex('status_1');
    } catch (err) {
      if (!err.message.includes('index not found')) throw err;
    }

    await coll.drop();
    console.log('[MIGRATION] Dropped committees collection');
  },
};
