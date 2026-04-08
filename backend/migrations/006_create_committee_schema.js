/**
 * Migration: 006_create_committee_schema
 *
 * Creates the D3 committees collection for committee management.
 */
module.exports = {
  name: '006_create_committee_schema',

  up: async (db) => {
    const conn = db.connection.db;

    const committeeCollections = await conn.listCollections({ name: 'committees' }).toArray();
    if (committeeCollections.length === 0) {
      await conn.createCollection('committees');
      console.log('[MIGRATION] Created committees collection');
    } else {
      console.log('[MIGRATION] committees collection already exists, skipping creation');
    }

    const committeesColl = conn.collection('committees');
    await committeesColl.createIndex({ committeeId: 1 }, { unique: true });
    console.log('[MIGRATION] Ensured index: committees.committeeId (unique)');
    await committeesColl.createIndex({ committeeName: 1 }, { unique: true });
    console.log('[MIGRATION] Ensured index: committees.committeeName (unique)');
    await committeesColl.createIndex({ coordinatorId: 1 });
    console.log('[MIGRATION] Ensured index: committees.coordinatorId');
    await committeesColl.createIndex({ status: 1 });
    console.log('[MIGRATION] Ensured index: committees.status');
  },

  down: async (db) => {
    const conn = db.connection.db;
    const exists = await conn.listCollections({ name: 'committees' }).toArray();
    if (exists.length > 0) {
      await conn.collection('committees').drop();
      console.log('[MIGRATION] Dropped committees collection');
    } else {
      console.log('[MIGRATION] committees collection does not exist, skipping drop');
    }
  },
};
