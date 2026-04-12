/**
 * Migration: 007_create_committee_schema
 * Creates D3 committees collection and ensures index strategy.
 */
module.exports = {
  name: '007_create_committee_schema',

  up: async (db) => {
    try {
      const collections = await db.connection.db.listCollections({ name: 'committees' }).toArray();

      if (collections.length === 0) {
        await db.connection.db.createCollection('committees');
        console.log('[MIGRATION] Created Committee collection');
      } else {
        console.log('[MIGRATION] Committee collection already exists, skipping creation');
      }

      const committeeCollection = db.connection.db.collection('committees');

      // Always create indices - MongoDB handles duplicates gracefully
      await committeeCollection.createIndex({ committeeId: 1 }, { unique: true });
      console.log('[MIGRATION] Ensured index: committeeId (unique)');

      await committeeCollection.createIndex(
        { committeeName: 1 },
        { unique: true, collation: { locale: 'en', strength: 2 } }
      );
      console.log('[MIGRATION] Ensured index: committeeName (unique)');

      // Compound unique index for coordinator isolating committee names
      await committeeCollection.createIndex({ coordinatorId: 1, committeeName: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
      console.log('[MIGRATION] Ensured index: coordinatorId + committeeName (unique)');

      await committeeCollection.createIndex({ status: 1 });
      console.log('[MIGRATION] Ensured index: status');

      await committeeCollection.createIndex({ coordinatorId: 1, status: 1 });
      console.log('[MIGRATION] Ensured index: coordinatorId + status');
    } catch (error) {
      console.error('[MIGRATION] Error in 007_create_committee_schema up:', error);
      throw error;
    }
  },

  down: async (db) => {
    try {
      const collections = await db.connection.db.listCollections({ name: 'committees' }).toArray();

      if (collections.length === 0) {
        console.log('[MIGRATION] Committee collection does not exist, skipping drop');
        return;
      }

      await db.connection.db.dropCollection('committees');
      console.log('[MIGRATION] Dropped Committee collection');
    } catch (error) {
      console.error('[MIGRATION] Error in 007_create_committee_schema down:', error);
      throw error;
    }
  },
};
