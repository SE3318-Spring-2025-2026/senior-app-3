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
const SprintIssue = require('../src/models/SprintIssue');

let MongoMemoryServer;
try {
  ({ MongoMemoryServer } = require('mongodb-memory-server'));
} catch (error) {
  MongoMemoryServer = null;
}

describe('Migrations - Runner and State Management', () => {
  let mongod;

  // Establish connection before tests
  beforeAll(async () => {
    if (MongoMemoryServer) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
      return;
    }

    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-migrations-test';
    await mongoose.connect(mongoUri);
  }, 60000);

  // Disconnect after tests
  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  }, 60000);

  // Clear collections and migration log before each test
  beforeEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
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

  describe('Process 7 canonical schema cleanup', () => {
    it('includes the new canonical cleanup migration in the registry', () => {
      const names = migrations.map((migration) => migration.name);
      expect(names).toContain('011_reconcile_process7_canonical_collections');
    });

    it('creates canonical indexes for sprint issues and sprint contributions', async () => {
      const migration = migrations.find(
        (entry) => entry.name === '011_reconcile_process7_canonical_collections'
      );

      await runMigrationUp(migration, mongoose);

      const sprintIssueIndexes = await mongoose.connection.db
        .collection('sprint_issues')
        .indexes();
      const sprintContributionIndexes = await mongoose.connection.db
        .collection('sprint_contributions')
        .indexes();

      expect(
        sprintIssueIndexes.some(
          (index) => index.unique && index.key.groupId === 1 && index.key.sprintId === 1 && index.key.issueKey === 1
        )
      ).toBe(true);
      expect(
        sprintContributionIndexes.some(
          (index) => index.unique && index.key.groupId === 1 && index.key.sprintId === 1 && index.key.studentId === 1
        )
      ).toBe(true);
    });

    it('backfills legacy contributionrecords into canonical sprint_contributions', async () => {
      await mongoose.connection.db.createCollection('contributionrecords');
      await mongoose.connection.db.collection('contributionrecords').insertOne({
        contributionRecordId: 'ctr_legacy',
        groupId: 'grp_legacy',
        sprintId: 'spr_legacy',
        studentId: 'std_legacy',
        storyPointsAssigned: 5,
        storyPointsCompleted: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const migration = migrations.find(
        (entry) => entry.name === '011_reconcile_process7_canonical_collections'
      );
      await runMigrationUp(migration, mongoose);

      const canonical = await mongoose.connection.db.collection('sprint_contributions').findOne({
        groupId: 'grp_legacy',
        sprintId: 'spr_legacy',
        studentId: 'std_legacy',
      });

      expect(canonical).toBeTruthy();
      expect(canonical.storyPointsAssigned).toBe(5);
      expect(canonical.storyPointsCompleted).toBe(3);
    });

    it('skips malformed legacy contributionrecords instead of collapsing them into one row', async () => {
      await mongoose.connection.db.createCollection('contributionrecords');
      await mongoose.connection.db.collection('contributionrecords').insertMany([
        {
          contributionRecordId: 'ctr_bad_1',
          sprintId: 'spr_missing_group',
          studentId: 'std_missing_group',
        },
        {
          contributionRecordId: 'ctr_bad_2',
          groupId: 'grp_missing_student',
          sprintId: 'spr_missing_student',
        },
      ]);

      const migration = migrations.find(
        (entry) => entry.name === '011_reconcile_process7_canonical_collections'
      );
      await runMigrationUp(migration, mongoose);

      const canonicalRows = await mongoose.connection.db
        .collection('sprint_contributions')
        .find({})
        .toArray();

      expect(canonicalRows).toHaveLength(0);
    });

    it('backfills github_sync_jobs validationRecords into canonical pr_validations', async () => {
      await mongoose.connection.db.createCollection('github_sync_jobs');
      await mongoose.connection.db.collection('github_sync_jobs').insertOne({
        jobId: 'ghsync_test',
        groupId: 'grp_pr',
        sprintId: 'spr_pr',
        status: 'COMPLETED',
        completedAt: new Date('2026-04-24T10:00:00.000Z'),
        validationRecords: [
          {
            issueKey: 'ISSUE-42',
            prId: '123',
            prUrl: 'https://github.com/example/repo/pull/123',
            mergeStatus: 'MERGED',
            rawState: 'clean',
            lastValidated: new Date('2026-04-24T09:59:00.000Z'),
          },
        ],
      });

      const migration = migrations.find(
        (entry) => entry.name === '011_reconcile_process7_canonical_collections'
      );
      await runMigrationUp(migration, mongoose);

      const validation = await mongoose.connection.db.collection('pr_validations').findOne({
        groupId: 'grp_pr',
        sprintId: 'spr_pr',
        issueKey: 'ISSUE-42',
        prId: '123',
      });

      expect(validation).toBeTruthy();
      expect(validation.mergeStatus).toBe('MERGED');
      expect(validation.prUrl).toBe('https://github.com/example/repo/pull/123');
      expect(validation.rawState).toBe('clean');
    });

    it('enforces canonical unique keys for sprint issues', async () => {
      await runMigrationUp(
        migrations.find((entry) => entry.name === '011_reconcile_process7_canonical_collections'),
        mongoose
      );

      await SprintIssue.create({
        groupId: 'grp_dupe',
        sprintId: 'spr_dupe',
        issueKey: 'ISSUE-1',
      });

      await expect(
        SprintIssue.create({
          groupId: 'grp_dupe',
          sprintId: 'spr_dupe',
          issueKey: 'ISSUE-1',
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });

    it('enforces canonical unique keys for sprint contributions', async () => {
      await runMigrationUp(
        migrations.find((entry) => entry.name === '011_reconcile_process7_canonical_collections'),
        mongoose
      );

      await ContributionRecord.create({
        groupId: 'grp_dupe',
        sprintId: 'spr_dupe',
        studentId: 'std_1',
      });

      await expect(
        ContributionRecord.create({
          groupId: 'grp_dupe',
          sprintId: 'spr_dupe',
          studentId: 'std_1',
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });

    it('writes SprintIssue and ContributionRecord to canonical collections', async () => {
      expect(SprintIssue.collection.collectionName).toBe('sprint_issues');
      expect(ContributionRecord.collection.collectionName).toBe('sprint_contributions');
    });
  });
});
