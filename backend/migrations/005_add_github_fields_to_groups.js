/**
 * Migration: 005_add_github_fields_to_groups
 *
 * Adds GitHub integration fields to the groups collection:
 * - githubRepoName: repository name for the GitHub project
 * - githubVisibility: visibility setting (private, public, internal) - defaults to 'private'
 *
 * Any pre-existing groups without these fields are backfilled with defaults.
 */

module.exports = {
  name: '005_add_github_fields_to_groups',

  up: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'groups' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] groups collection does not exist, skipping migration');
      return;
    }

    const coll = conn.collection('groups');

    // Backfill existing documents that lack githubRepoName and githubVisibility
    const result = await coll.updateMany(
      { $and: [{ githubRepoName: { $exists: false } }, { githubVisibility: { $exists: false } }] },
      { $set: { githubRepoName: null, githubVisibility: 'private' } }
    );
    console.log(`[MIGRATION] Backfilled GitHub fields on ${result.modifiedCount} group document(s)`);

    // Add indexes for GitHub integration queries
    await coll.createIndex({ githubOrg: 1 });
    console.log('[MIGRATION] Ensured index: groups.githubOrg');
  },

  down: async (db) => {
    const conn = db.connection.db;

    const collections = await conn.listCollections({ name: 'groups' }).toArray();
    if (collections.length === 0) {
      console.log('[MIGRATION] groups collection does not exist, skipping rollback');
      return;
    }

    const coll = conn.collection('groups');

    // Remove the added fields
    const result = await coll.updateMany(
      {},
      { $unset: { githubRepoName: '', githubVisibility: '' } }
    );
    console.log(`[MIGRATION] Removed GitHub fields from ${result.modifiedCount} group document(s)`);

    // Drop indexes
    try {
      await coll.dropIndex('githubOrg_1');
      console.log('[MIGRATION] Dropped index: groups.githubOrg');
    } catch (err) {
      if (!err.message.includes('index not found')) {
        throw err;
      }
    }
  },
};
