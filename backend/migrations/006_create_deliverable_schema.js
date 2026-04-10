module.exports = {
  up: async (db) => {
    // D4: Create deliverables collection with indexes
    const deliverableCollection = db.collection('deliverables');
    
    await deliverableCollection.createIndex({ deliverableId: 1 }, { unique: true });
    await deliverableCollection.createIndex({ committeeId: 1 });
    await deliverableCollection.createIndex({ groupId: 1 });
    await deliverableCollection.createIndex({ type: 1 });
    await deliverableCollection.createIndex({ committeeId: 1, groupId: 1 });
    await deliverableCollection.createIndex({ groupId: 1, type: 1 });
    await deliverableCollection.createIndex({ submittedAt: -1 });

    console.log('[Migration 006] D4 deliverables collection created with indexes');
  },

  down: async (db) => {
    // Drop collection
    await db.collection('deliverables').drop().catch(() => {});
    console.log('[Migration 006] D4 deliverables collection dropped');
  },
};
