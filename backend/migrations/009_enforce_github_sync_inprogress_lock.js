/**
 * Migration: 009_enforce_github_sync_inprogress_lock
 *
 * Ensures the DB-level lock index for GitHub sync jobs is safe to apply
 * on existing datasets:
 * - Deduplicates legacy IN_PROGRESS jobs per (groupId, sprintId)
 * - Creates unique partial index on {groupId, sprintId} where status=IN_PROGRESS
 */

module.exports = {
  name: '009_enforce_github_sync_inprogress_lock',

  up: async (db) => {
    const conn = db.connection.db;
    const collections = await conn.listCollections({ name: 'github_sync_jobs' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] github_sync_jobs collection does not exist, skipping');
      return;
    }

    const coll = conn.collection('github_sync_jobs');

    const duplicateGroups = await coll
      .aggregate([
        { $match: { status: 'IN_PROGRESS' } },
        {
          $group: {
            _id: { groupId: '$groupId', sprintId: '$sprintId' },
            ids: { $push: '$_id' },
            count: { $sum: 1 },
            latestCreatedAt: { $max: '$createdAt' },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    let resolvedJobs = 0;
    for (const group of duplicateGroups) {
      const jobs = await coll
        .find({ _id: { $in: group.ids } })
        .sort({ createdAt: -1, _id: -1 })
        .toArray();

      const [winner, ...duplicates] = jobs;
      if (!winner || duplicates.length === 0) continue;

      const duplicateIds = duplicates.map((d) => d._id);
      const result = await coll.updateMany(
        { _id: { $in: duplicateIds }, status: 'IN_PROGRESS' },
        {
          $set: {
            status: 'FAILED',
            completedAt: new Date(),
            errorCode: 'LOCK_CONFLICT_RECOVERED',
            errorMessage: 'Resolved during migration before enforcing unique IN_PROGRESS lock',
          },
        }
      );
      resolvedJobs += result.modifiedCount;
    }

    if (resolvedJobs > 0) {
      console.log(`[MIGRATION] Resolved ${resolvedJobs} duplicate IN_PROGRESS GitHub sync job(s)`);
    }

    const indexName = 'groupId_1_sprintId_1';
    await coll.createIndex(
      { groupId: 1, sprintId: 1 },
      { name: indexName, unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } }
    );
    console.log('[MIGRATION] Ensured unique partial lock index on github_sync_jobs');
  },

  down: async (db) => {
    const conn = db.connection.db;
    const collections = await conn.listCollections({ name: 'github_sync_jobs' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] github_sync_jobs collection does not exist, skipping rollback');
      return;
    }

    const coll = conn.collection('github_sync_jobs');
    try {
      await coll.dropIndex('groupId_1_sprintId_1');
      console.log('[MIGRATION] Dropped github_sync_jobs lock index');
    } catch (err) {
      if (!String(err.message || '').includes('index not found')) {
        throw err;
      }
    }
  },
};
