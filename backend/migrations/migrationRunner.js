/**
 * Migration Runner - Executes database migrations in sequence
 * Tracks applied migrations in MongoDB _migrations collection
 * Supports both up (apply) and down (rollback) operations
 */

const mongoose = require('mongoose');

// Migration tracking schema
const migrationSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  appliedAt: { type: Date, default: Date.now },
  version: { type: String, default: '1.0' },
});

const MigrationLog = mongoose.model('_migration', migrationSchema);

/**
 * Get all applied migrations
 * @returns {Promise<Array>} List of applied migration objects
 */
async function getAppliedMigrations() {
  try {
    return await MigrationLog.find().sort({ appliedAt: 1 });
  } catch (error) {
    if (error.name === 'MongoServerError' && error.code === 26) {
      // Collection doesn't exist yet
      return [];
    }
    throw error;
  }
}

/**
 * Check if a migration has been applied
 * @param {string} migrationName - Name/id of the migration (e.g., '001_create_user_schema')
 * @returns {Promise<boolean>} True if migration has been applied
 */
async function isMigrationApplied(migrationName) {
  const applied = await MigrationLog.findOne({ name: migrationName });
  return !!applied;
}

/**
 * Record a migration as applied
 * @param {string} migrationName - Name/id of the migration
 * @returns {Promise<Object>} The created migration log entry
 */
async function recordMigration(migrationName) {
  const migration = new MigrationLog({ name: migrationName });
  return await migration.save();
}

/**
 * Remove a migration from the log (used for rollback)
 * @param {string} migrationName - Name/id of the migration to remove
 * @returns {Promise<Object>} The deleted migration log entry
 */
async function removeFromMigrationLog(migrationName) {
  return await MigrationLog.findOneAndDelete({ name: migrationName });
}

/**
 * Execute a migration's up function
 * @param {Object} migration - Migration object with { name, up, down } properties
 * @param {Object} db - Mongoose connection object
 * @returns {Promise<void>}
 */
async function runMigrationUp(migration, db) {
  console.log(`\n[MIGRATION] Running: ${migration.name}`);
  
  // Check if already applied
  if (await isMigrationApplied(migration.name)) {
    console.log(`[MIGRATION] Already applied: ${migration.name}`);
    return;
  }

  try {
    // Execute the migration's up function
    await migration.up(db);
    
    // Record as applied
    await recordMigration(migration.name);
    console.log(`[MIGRATION] ✓ Applied: ${migration.name}`);
  } catch (error) {
    console.error(`[MIGRATION] ✗ Failed: ${migration.name}`);
    console.error(error);
    throw error;
  }
}

/**
 * Execute a migration's down function (rollback)
 * @param {Object} migration - Migration object with { name, up, down } properties
 * @param {Object} db - Mongoose connection object
 * @returns {Promise<void>}
 */
async function runMigrationDown(migration, db) {
  console.log(`\n[MIGRATION] Rolling back: ${migration.name}`);
  
  // Check if migration was applied
  if (!(await isMigrationApplied(migration.name))) {
    console.log(`[MIGRATION] Not applied, skipping: ${migration.name}`);
    return;
  }

  try {
    // Execute the migration's down function
    await migration.down(db);
    
    // Remove from log
    await removeFromMigrationLog(migration.name);
    console.log(`[MIGRATION] ✓ Rolled back: ${migration.name}`);
  } catch (error) {
    console.error(`[MIGRATION] ✗ Rollback failed: ${migration.name}`);
    console.error(error);
    throw error;
  }
}

/**
 * Get migration status (list all available and applied migrations)
 * @param {Array} allMigrations - Array of all available migration objects
 * @returns {Promise<Object>} Status object with applied, pending, and available migrations
 */
async function getMigrationStatus(allMigrations) {
  const applied = await getAppliedMigrations();
  const appliedNames = new Set(applied.map(m => m.name));
  const pending = allMigrations.filter(m => !appliedNames.has(m.name));

  return {
    applied: applied.map(m => ({ name: m.name, appliedAt: m.appliedAt })),
    pending: pending.map(m => ({ name: m.name })),
    total: {
      available: allMigrations.length,
      applied: applied.length,
      pending: pending.length,
    },
  };
}

/**
 * Reset all migrations (dangerous operation - use with caution)
 * @param {Array} allMigrations - Array of all available migration objects in REVERSE order
 * @param {Object} db - Mongoose connection object
 * @returns {Promise<void>}
 */
async function resetAllMigrations(allMigrations, db) {
  console.log(`\n[MIGRATION] WARNING: Resetting all migrations...`);
  const applied = await getAppliedMigrations();
  
  // Run down in reverse order of application
  for (let i = applied.length - 1; i >= 0; i--) {
    const appliedMigration = applied[i];
    const migration = allMigrations.find(m => m.name === appliedMigration.name);
    
    if (migration) {
      await runMigrationDown(migration, db);
    } else {
      // Migration no longer exists but was applied - just remove from log
      await removeFromMigrationLog(appliedMigration.name);
      console.log(`[MIGRATION] ✓ Removed orphaned log entry: ${appliedMigration.name}`);
    }
  }
  
  console.log(`[MIGRATION] ✓ All migrations reset`);
}

module.exports = {
  MigrationLog,
  getAppliedMigrations,
  isMigrationApplied,
  recordMigration,
  removeFromMigrationLog,
  runMigrationUp,
  runMigrationDown,
  getMigrationStatus,
  resetAllMigrations,
};
