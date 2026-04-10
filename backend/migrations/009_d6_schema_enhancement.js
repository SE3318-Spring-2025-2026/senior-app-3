module.exports = {
  up: async (db) => {
    // Issue #86: Enhance D6 schema for committee assignment and cross-reference ingestion
    const sprintRecordCollection = db.collection('sprint_records');

    // Add compound index for efficient f14 cross-reference queries
    await sprintRecordCollection.createIndex(
      { 'deliverableRefs.deliverableId': 1, groupId: 1 },
      { name: 'deliverableRefs_groupId_idx' }
    ).catch((err) => {
      if (!err.message.includes('already exists')) throw err;
    });

    // Add index for committee assignment window queries
    await sprintRecordCollection.createIndex(
      { committeeId: 1, committeeAssignedAt: -1 },
      { name: 'committeeAssignedAt_idx' }
    ).catch((err) => {
      if (!err.message.includes('already exists')) throw err;
    });

    console.log('[Migration 009] D6 schema enhancement for Issue #86 (f13/f14) completed');
  },

  down: async (db) => {
    const sprintRecordCollection = db.collection('sprint_records');
    
    // Drop Issue #86 specific indexes
    await sprintRecordCollection.dropIndex('deliverableRefs_groupId_idx').catch(() => {});
    await sprintRecordCollection.dropIndex('committeeAssignedAt_idx').catch(() => {});

    console.log('[Migration 009] D6 schema enhancement rolled back');
  },
};
