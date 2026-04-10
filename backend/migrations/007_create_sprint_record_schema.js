module.exports = {
  up: async (db) => {
    // D6: Create sprint_records collection with indexes
    // Issue #86: Sprint record update on committee publish (Flow f13)
    const sprintRecordCollection = db.collection('sprint_records');
    
    await sprintRecordCollection.createIndex({ sprintRecordId: 1 }, { unique: true });
    await sprintRecordCollection.createIndex({ sprintId: 1 });
    await sprintRecordCollection.createIndex({ groupId: 1 });
    await sprintRecordCollection.createIndex({ committeeId: 1 }); // Issue #86: f13 query
    await sprintRecordCollection.createIndex({ sprintId: 1, groupId: 1 });
    await sprintRecordCollection.createIndex({ committeeId: 1, sprintId: 1 }); // Issue #86: atomic publish
    await sprintRecordCollection.createIndex({ groupId: 1, status: 1 });

    console.log('[Migration 007] D6 sprint_records collection created with indexes');
  },

  down: async (db) => {
    // Drop collection
    await db.collection('sprint_records').drop().catch(() => {});
    console.log('[Migration 007] D6 sprint_records collection dropped');
  },
};
