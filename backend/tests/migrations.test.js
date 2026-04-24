/**
 * Migration Tests
 * 
 * Tests for migration runner functionality: idempotency, rollback, and state tracking.
 * 
 * Test Database: MongoDB Memory Server (or test instance)
 * 
 * Run: npm run test -- migrations.test.js
 */

const mongoose = require('mongoose');
const migrations = require('../migrations');
const {
  MigrationLog,
  getAppliedMigrations,
  isMigrationApplied,
  recordMigration,
  removeFromMigrationLog,
  runMigrationUp,
  runMigrationDown,
  getMigrationStatus,
} = require('../migrations/migrationRunner');
const User = require('../src/models/User');
const ContributionRecord = require('../src/models/ContributionRecord');

describe('Migrations - Runner and State Management', () => {
  // Establish connection before tests
  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-migrations-test';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  // Disconnect after tests
  afterAll(async () => {
    await mongoose.disconnect();
  });

  // Clear collections and migration log before each test
  beforeEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(
      Object.values(collections).map((collection) => collection.deleteMany({}))
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Migration Tracking
  // ══════════════════════════════════════════════════════════════════════════

  describe('Migration Tracking', () => {
    it('should record a migration as applied', async () => {
      await recordMigration('test_migration');
      const applied = await getAppliedMigrations();

      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe('test_migration');
      expect(applied[0].appliedAt).toBeInstanceOf(Date);
    });

    it('should check if a migration has been applied', async () => {
      await recordMigration('test_migration');
      const isApplied = await isMigrationApplied('test_migration');

      expect(isApplied).toBe(true);
    });

    it('should return false for unapplied migrations', async () => {
      const isApplied = await isMigrationApplied('nonexistent_migration');

      expect(isApplied).toBe(false);
    });

    it('should remove migration from log', async () => {
      await recordMigration('test_migration');
      let applied = await getAppliedMigrations();
      expect(applied).toHaveLength(1);

      await removeFromMigrationLog('test_migration');
      applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });

    it('should list all applied migrations in order', async () => {
      await recordMigration('001_migration');
      await recordMigration('002_migration');
      await recordMigration('003_migration');

      const applied = await getAppliedMigrations();

      expect(applied).toHaveLength(3);
      expect(applied[0].name).toBe('001_migration');
      expect(applied[1].name).toBe('002_migration');
      expect(applied[2].name).toBe('003_migration');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Migration Status
  // ══════════════════════════════════════════════════════════════════════════

  describe('Migration Status', () => {
    it('should show all migrations as pending initially', async () => {
      const status = await getMigrationStatus(migrations);

      expect(status.applied).toHaveLength(0);
      expect(status.pending).toHaveLength(migrations.length);
      expect(status.total.applied).toBe(0);
      expect(status.total.pending).toBe(migrations.length);
      expect(status.total.available).toBe(migrations.length);
    });

    it('should show applied migrations correctly', async () => {
      await recordMigration('001_create_user_schema');
      const status = await getMigrationStatus(migrations);

      expect(status.applied).toHaveLength(1);
      expect(status.applied[0].name).toBe('001_create_user_schema');
      expect(status.pending).toHaveLength(migrations.length - 1);
    });

    it('should list correct pending migrations', async () => {
      await recordMigration('001_create_user_schema');
      const status = await getMigrationStatus(migrations);

      const pendingNames = status.pending.map(m => m.name);
      expect(pendingNames).toContain('002_add_githubUsername_unique_constraint');
      expect(pendingNames).not.toContain('001_create_user_schema');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Migration Execution - Up
  // ══════════════════════════════════════════════════════════════════════════

  describe('Migration Execution - Up', () => {
    it('should run a migration and record it', async () => {
      const migration = migrations[0];
      await runMigrationUp(migration, mongoose);

      const isApplied = await isMigrationApplied(migration.name);
      expect(isApplied).toBe(true);
    });

    it('should not re-run an already applied migration', async () => {
      const migration = migrations[0];

      // First run
      await runMigrationUp(migration, mongoose);
      let applied = await getAppliedMigrations();
      expect(applied).toHaveLength(1);

      // Second run (should be skipped)
      await runMigrationUp(migration, mongoose);
      applied = await getAppliedMigrations();
      expect(applied).toHaveLength(1); // Still 1, not duplicated
    });

    it('should run multiple migrations in sequence', async () => {
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(migrations.length);
    });

    it('should maintain migration order', async () => {
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      const applied = await getAppliedMigrations();
      expect(applied[0].name).toBe('001_create_user_schema');
      expect(applied[1].name).toBe('002_add_githubUsername_unique_constraint');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Migration Execution - Down (Rollback)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Migration Execution - Down (Rollback)', () => {
    it('should skip rollback for unapplied migrations', async () => {
      const migration = migrations[0];

      // Rollback without applying first
      await runMigrationDown(migration, mongoose);

      const isApplied = await isMigrationApplied(migration.name);
      expect(isApplied).toBe(false);
    });

    it('should rollback an applied migration', async () => {
      const migration = migrations[0];

      // Apply
      await runMigrationUp(migration, mongoose);
      let isApplied = await isMigrationApplied(migration.name);
      expect(isApplied).toBe(true);

      // Rollback
      await runMigrationDown(migration, mongoose);
      isApplied = await isMigrationApplied(migration.name);
      expect(isApplied).toBe(false);
    });

    it('should remove migration from log on rollback', async () => {
      const migration = migrations[0];

      await runMigrationUp(migration, mongoose);
      let applied = await getAppliedMigrations();
      expect(applied).toHaveLength(1);

      await runMigrationDown(migration, mongoose);
      applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });

    it('should rollback migrations in reverse order', async () => {
      // Apply all
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      let applied = await getAppliedMigrations();
      expect(applied).toHaveLength(migrations.length);

      // Rollback in reverse order
      for (let i = migrations.length - 1; i >= 0; i--) {
        await runMigrationDown(migrations[i], mongoose);
      }

      applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Idempotency
  // ══════════════════════════════════════════════════════════════════════════

  describe('Idempotency', () => {
    it('migration 001 should be idempotent (safe to run multiple times)', async () => {
      const migration = migrations.find(m => m.name === '001_create_user_schema');

      // Run 3 times
      await runMigrationUp(migration, mongoose);
      await runMigrationUp(migration, mongoose);
      await runMigrationUp(migration, mongoose);

      // Should only be recorded once
      const applied = await getAppliedMigrations();
      const recordCount = applied.filter(m => m.name === migration.name).length;
      expect(recordCount).toBe(1);
    });

    it('migration 002 should be idempotent (safe to run multiple times)', async () => {
      const migration = migrations.find(m => m.name === '002_add_githubUsername_unique_constraint');

      // Run 3 times
      await runMigrationUp(migration, mongoose);
      await runMigrationUp(migration, mongoose);
      await runMigrationUp(migration, mongoose);

      // Should only be recorded once
      const applied = await getAppliedMigrations();
      const recordCount = applied.filter(m => m.name === migration.name).length;
      expect(recordCount).toBe(1);
    });

    it('up-down-up should be idempotent', async () => {
      const migration = migrations[0];

      // Up, Down, Up
      await runMigrationUp(migration, mongoose);
      await runMigrationDown(migration, mongoose);
      await runMigrationUp(migration, mongoose);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe(migration.name);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Migration 001: Create User Schema
  // ══════════════════════════════════════════════════════════════════════════

  describe('Migration 001 - Create User Schema', () => {
    it('should allow user creation after migration', async () => {
      const migration = migrations.find(m => m.name === '001_create_user_schema');
      await runMigrationUp(migration, mongoose);

      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved._id).toBeDefined();
    });

    it('should be safe to rollback and reapply', async () => {
      const migration = migrations.find(m => m.name === '001_create_user_schema');

      // Create test data
      await runMigrationUp(migration, mongoose);
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });
      await user.save();

      // Rollback (drops collection)
      await runMigrationDown(migration, mongoose);

      // Reapply
      await runMigrationUp(migration, mongoose);

      // Should be able to create users again
      const newUser = new User({
        email: 'newtest@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await newUser.save();
      expect(saved._id).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Migration 002: GitHub Username Unique Constraint
  // ══════════════════════════════════════════════════════════════════════════

  describe('Migration 002 - Add githubUsername Unique Constraint', () => {
    beforeEach(async () => {
      const migration001 = migrations.find(m => m.name === '001_create_user_schema');
      await runMigrationUp(migration001, mongoose);
    });

    it('should enforce githubUsername uniqueness after migration', async () => {
      const migration = migrations.find(m => m.name === '002_add_githubUsername_unique_constraint');
      await runMigrationUp(migration, mongoose);

      const user1 = new User({
        email: 'user1@example.com',
        hashedPassword: 'hash123',
        githubUsername: 'alice-gh',
      });

      await user1.save();

      const user2 = new User({
        email: 'user2@example.com',
        hashedPassword: 'hash123',
        githubUsername: 'alice-gh',
      });

      await expect(user2.save()).rejects.toThrow(/duplicate key|E11000/);
    });

    it('should allow multiple null githubUsername values', async () => {
      const migration = migrations.find(m => m.name === '002_add_githubUsername_unique_constraint');
      await runMigrationUp(migration, mongoose);

      const user1 = new User({
        email: 'user1@example.com',
        hashedPassword: 'hash123',
        githubUsername: null,
      });

      const user2 = new User({
        email: 'user2@example.com',
        hashedPassword: 'hash123',
        githubUsername: null,
      });

      const saved1 = await user1.save();
      const saved2 = await user2.save();

      expect(saved1._id).toBeDefined();
      expect(saved2._id).toBeDefined();
    });

    it('should rollback and allow duplicate githubUsername', async () => {
      const migration = migrations.find(m => m.name === '002_add_githubUsername_unique_constraint');

      // Apply
      await runMigrationUp(migration, mongoose);

      const user1 = new User({
        email: 'user1@example.com',
        hashedPassword: 'hash123',
        githubUsername: 'alice-gh',
      });

      await user1.save();

      // Rollback
      await runMigrationDown(migration, mongoose);

      // Now duplicate should be allowed (no unique constraint)
      const user2 = new User({
        email: 'user2@example.com',
        hashedPassword: 'hash123',
        githubUsername: 'alice-gh',
      });

      // This should succeed after rollback (constraint removed)
      const saved = await user2.save();
      expect(saved._id).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Full Workflow
  // ══════════════════════════════════════════════════════════════════════════

  describe('Full Migration Workflow', () => {
    it('should apply all migrations in sequence', async () => {
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(migrations.length);

      const status = await getMigrationStatus(migrations);
      expect(status.total.applied).toBe(migrations.length);
      expect(status.total.pending).toBe(0);
    });

    it('should create valid users after all migrations', async () => {
      // Apply all migrations
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      // Create user
      const user = new User({
        email: 'alice@example.com',
        hashedPassword: 'hash123',
        role: 'student',
        githubUsername: 'alice-gh',
        emailVerified: true,
        accountStatus: 'active',
      });

      const saved = await user.save();

      // Verify all fields
      expect(saved.userId).toMatch(/^usr_/);
      expect(saved.email).toBe('alice@example.com');
      expect(saved.role).toBe('student');
      expect(saved.githubUsername).toBe('alice-gh');
      expect(saved.emailVerified).toBe(true);
      expect(saved.accountStatus).toBe('active');
      expect(saved.createdAt).toBeInstanceOf(Date);
    });

    it('should handle rollback of all migrations', async () => {
      // Apply all migrations
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      // Rollback all in reverse order
      const reversedMigrations = [...migrations].reverse();
      for (const migration of reversedMigrations) {
        await runMigrationDown(migration, mongoose);
      }

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });

    it('should support complete up-down-up cycle', async () => {
      // Up
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      let status = await getMigrationStatus(migrations);
      expect(status.total.applied).toBe(migrations.length);

      // Create test data
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });
      await user.save();

      // Down (all)
      const reversedMigrations = [...migrations].reverse();
      for (const migration of reversedMigrations) {
        await runMigrationDown(migration, mongoose);
      }

      status = await getMigrationStatus(migrations);
      expect(status.total.applied).toBe(0);

      // Up (all again)
      for (const migration of migrations) {
        await runMigrationUp(migration, mongoose);
      }

      status = await getMigrationStatus(migrations);
      expect(status.total.applied).toBe(migrations.length);

      // Should be able to create new users
      const newUser = new User({
        email: 'newtest@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await newUser.save();
      expect(saved._id).toBeDefined();
    });
  });

  describe('Migration 011 - Canonical Process 7 Collections', () => {
    const migrationName = '011_reconcile_process7_canonical_collections';

    const run011 = async () => {
      const migration = migrations.find((m) => m.name === migrationName);
      expect(migration).toBeDefined();
      await runMigrationUp(migration, mongoose);
      return migration;
    };

    it('should be registered in migration index', () => {
      const names = migrations.map((m) => m.name);
      expect(names).toContain(migrationName);
    });

    it('should backfill github_sync_jobs.validationRecords into pr_validations', async () => {
      await mongoose.connection.db.createCollection('github_sync_jobs');
      await mongoose.connection.db.collection('github_sync_jobs').insertOne({
        jobId: 'ghsync_test_1',
        groupId: 'grp_011',
        sprintId: 'spr_011',
        validationRecords: [
          {
            issueKey: 'ISSUE-101',
            prId: '42',
            prUrl: 'https://example.com/pr/42',
            mergeStatus: 'MERGED',
            rawState: 'merged',
            lastValidated: new Date('2026-01-01T10:00:00.000Z'),
          },
        ],
        completedAt: new Date('2026-01-01T10:01:00.000Z'),
      });

      await run011();

      const row = await mongoose.connection.db.collection('pr_validations').findOne({
        groupId: 'grp_011',
        sprintId: 'spr_011',
        issueKey: 'ISSUE-101',
        prId: '42',
      });
      expect(row).toBeTruthy();
      expect(row.mergeStatus).toBe('MERGED');
      expect(row.prUrl).toBe('https://example.com/pr/42');
    });

    it('should skip malformed contributionrecords with null canonical ids', async () => {
      await mongoose.connection.db.createCollection('contributionrecords');
      await mongoose.connection.db.collection('contributionrecords').insertMany([
        {
          contributionRecordId: 'ctr_valid',
          groupId: 'grp_valid',
          sprintId: 'spr_valid',
          studentId: 'std_valid',
          storyPointsAssigned: 8,
        },
        {
          contributionRecordId: 'ctr_bad',
          groupId: null,
          sprintId: 'spr_bad',
          studentId: 'std_bad',
          storyPointsAssigned: 13,
        },
      ]);

      await run011();

      const valid = await mongoose.connection.db.collection('sprint_contributions').findOne({
        contributionRecordId: 'ctr_valid',
      });
      const malformed = await mongoose.connection.db.collection('sprint_contributions').findOne({
        contributionRecordId: 'ctr_bad',
      });

      expect(valid).toBeTruthy();
      expect(malformed).toBeFalsy();
    });

    it('should set locked=false by default for backfilled rows', async () => {
      await mongoose.connection.db.createCollection('contributionrecords');
      await mongoose.connection.db.collection('contributionrecords').insertOne({
        contributionRecordId: 'ctr_lock_default',
        groupId: 'grp_lock',
        sprintId: 'spr_lock',
        studentId: 'std_lock',
      });

      await run011();

      const row = await mongoose.connection.db.collection('sprint_contributions').findOne({
        contributionRecordId: 'ctr_lock_default',
      });
      expect(row).toBeTruthy();
      expect(row.locked).toBe(false);
    });

    it('should enforce canonical unique key on sprint_contributions', async () => {
      await run011();
      await ContributionRecord.create({
        groupId: 'grp_unique',
        sprintId: 'spr_unique',
        studentId: 'std_unique',
      });

      await expect(
        ContributionRecord.create({
          groupId: 'grp_unique',
          sprintId: 'spr_unique',
          studentId: 'std_unique',
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });
  });
});
