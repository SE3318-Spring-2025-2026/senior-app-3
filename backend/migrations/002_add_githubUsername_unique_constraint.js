/**
 * Migration: 002_add_githubUsername_unique_constraint
 * 
 * Adds a sparse unique index on githubUsername field.
 * Sparse index allows multiple null values (users without linked GitHub accounts)
 * while enforcing uniqueness for non-null values (no duplicate GitHub accounts).
 * 
 * Rationale:
 *   - GitHub usernames are unique identifiers when present (users link during process 1.3)
 *   - Multiple users may not have GitHub linked yet (null values)
 *   - Sparse index enforcement: unique constraint applies only to non-null values
 *   - Automatically normalizes githubUsername to lowercase and trimmed for consistency
 */

module.exports = {
  name: '002_add_githubUsername_unique_constraint',

  /**
   * Apply migration: Create sparse unique index on githubUsername
   * Idempotent: Safe to run multiple times (checks if index exists)
   */
  up: async (db) => {
    try {
      const User = db.model('User');

      // Drop any pre-existing githubUsername indexes (old sparse or unnamed)
      for (const name of ['githubUsername_1', 'githubUsername_1_unique']) {
        try {
          await User.collection.dropIndex(name);
        } catch (e) {
          console.log(`[MIGRATION] Index ${name} not found, skipping drop:`, e.message);
        }
      }

      // Use a partial index so that null values are not indexed (sparse indexes
      // still index null in modern MongoDB, which would block multiple null values)
      await User.collection.createIndex(
        { githubUsername: 1 },
        {
          unique: true,
          partialFilterExpression: { githubUsername: { $type: 'string' } },
          name: 'githubUsername_1_unique',
        }
      );

      console.log('[MIGRATION] Created partial unique index on githubUsername');
    } catch (error) {
      // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — index already exists
      if (error.code === 85 || error.code === 86) {
        console.log('[MIGRATION] githubUsername unique constraint already exists, skipping');
        return;
      }
      console.error('[MIGRATION] Error in 002_add_githubUsername_unique_constraint up:', error);
      throw error;
    }
  },

  /**
   * Rollback migration: Drop partial unique index on githubUsername
   */
  down: async (db) => {
    try {
      const User = db.model('User');
      await User.collection.dropIndex('githubUsername_1_unique');
      console.log('[MIGRATION] Dropped partial unique index on githubUsername');
    } catch (error) {
      if (error.message.includes('index not found') || error.code === 27) {
        console.log('[MIGRATION] githubUsername index does not exist, skipping drop');
        return;
      }
      console.error('[MIGRATION] Error in 002_add_githubUsername_unique_constraint down:', error);
      throw error;
    }
  },
};
