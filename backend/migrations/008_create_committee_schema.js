module.exports = {
  up: async (db) => {
    // D3: Create committees collection with indexes
    const committeeCollection = db.collection('committees');
    
    await committeeCollection.createIndex({ committeeId: 1 }, { unique: true });
    await committeeCollection.createIndex({ committeeName: 1 }, { unique: true });
    await committeeCollection.createIndex({ status: 1 });
    await committeeCollection.createIndex({ createdBy: 1, status: 1 });
    await committeeCollection.createIndex({ status: 1, publishedAt: -1 });

    console.log('[Migration 008] D3 committees collection created with indexes');
  },

  down: async (db) => {
    // Drop collection
    await db.collection('committees').drop().catch(() => {});
    console.log('[Migration 008] D3 committees collection dropped');
  },
};
