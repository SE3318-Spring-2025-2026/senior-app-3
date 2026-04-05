/**
 * Migration CLI - Execute database migrations
 * 
 * Usage:
 *   npm run migrate:status       - Show migration status
 *   npm run migrate:up           - Apply all pending migrations
 *   npm run migrate:down         - Rollback the last applied migration
 *   npm run migrate:reset        - Reset all migrations (destructive!)
 */

const mongoose = require('mongoose');
require('dotenv').config();

const migrations = require('../migrations');
const {
  getMigrationStatus,
  runMigrationUp,
  runMigrationDown,
  resetAllMigrations,
} = require('../migrations/migrationRunner');

// Get command from process arguments
const command = process.argv[2] || 'status';

async function main() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/senior-app';
    
    console.log(`[MIGRATION] Connecting to MongoDB: ${mongoUri.replace(/\/\/.*:.*@/, '//***:***@')}`);
    await mongoose.connect(mongoUri);
    console.log('[MIGRATION] Connected to MongoDB');

    // Import User model to ensure schema is registered
    require('./models/User');

    const db = mongoose;

    switch (command) {
      case 'status':
        await handleStatus(db);
        break;
      case 'up':
        await handleUp(db);
        break;
      case 'down':
        await handleDown(db);
        break;
      case 'reset':
        await handleReset(db);
        break;
      default:
        console.log('Unknown command:', command);
        console.log('Available commands: status, up, down, reset');
        process.exit(1);
    }
  } catch (error) {
    console.error('[MIGRATION] Fatal error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('[MIGRATION] Disconnected from MongoDB\n');
  }
}

/**
 * Handle status command - show which migrations are applied and pending
 */
async function handleStatus(db) {
  const status = await getMigrationStatus(migrations);
  
  console.log('\n════════════════════════════════════════────');
  console.log('MIGRATION STATUS');
  console.log('════════════════════════════════════════════');
  
  if (status.applied.length > 0) {
    console.log(`\n✓ Applied Migrations (${status.applied.length}):`);
    status.applied.forEach(m => {
      const appliedDate = new Date(m.appliedAt).toISOString();
      console.log(`  • ${m.name} [${appliedDate}]`);
    });
  } else {
    console.log('\n✓ Applied Migrations: None');
  }

  if (status.pending.length > 0) {
    console.log(`\n⏳ Pending Migrations (${status.pending.length}):`);
    status.pending.forEach(m => {
      console.log(`  • ${m.name}`);
    });
  } else {
    console.log('\n⏳ Pending Migrations: None');
  }

  console.log(`\nℹ Summary: ${status.total.applied}/${status.total.available} migrations applied`);
  console.log('════════════════════════════════════════════\n');
}

/**
 * Handle up command - apply all pending migrations
 */
async function handleUp(db) {
  const status = await getMigrationStatus(migrations);
  
  if (status.pending.length === 0) {
    console.log('\n✓ All migrations already applied');
    return;
  }

  console.log(`\n⏳ Applying ${status.pending.length} pending migration(s)...`);
  
  for (const migration of migrations) {
    await runMigrationUp(migration, db);
  }

  console.log('\n✓ All migrations applied successfully\n');
}

/**
 * Handle down command - rollback the last applied migration
 */
async function handleDown(db) {
  const applied = await getMigrationStatus(migrations);
  
  if (applied.applied.length === 0) {
    console.log('\n✓ No migrations to rollback');
    return;
  }

  const lastMigration = migrations[migrations.length - 1];
  
  console.log(`\n⏳ Rolling back last migration...`);
  await runMigrationDown(lastMigration, db);
  
  console.log('\n✓ Migration rolled back successfully\n');
}

/**
 * Handle reset command - rollback all migrations (destructive)
 */
async function handleReset(db) {
  const response = await new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('⚠️  WARNING: This will delete all user data and reset the database.\n   Are you sure? (type "yes" to confirm): ', answer => {
      rl.close();
      resolve(answer);
    });
  });

  if (response !== 'yes') {
    console.log('\n✓ Reset cancelled\n');
    return;
  }

  console.log(`\n⏳ Resetting all migrations...`);
  
  // Reset in reverse order
  const reversedMigrations = [...migrations].reverse();
  await resetAllMigrations(reversedMigrations, db);
  
  console.log('\n✓ All migrations reset successfully\n');
}

main().catch(error => {
  console.error('[MIGRATION] Fatal error:', error);
  process.exit(1);
});
