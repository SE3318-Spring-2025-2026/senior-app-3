/**
 * User Model Tests
 * 
 * Tests for User schema validation, constraints, defaults, and index enforcement.
 * Verifies conformance to OpenAPI UserAccount specification.
 * 
 * Test Database: MongoDB Memory Server (or test instance)
 * 
 * Run: npm run test -- User.model.test.js
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');

describe('User Model - Schema Validation', () => {
  // Establish connection before tests
  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Run migrations to ensure all indexes (including githubUsername partial index) are created
    const allMigrations = require('../migrations');
    const { runMigrationUp } = require('../migrations/migrationRunner');
    for (const migration of allMigrations) {
      await runMigrationUp(migration, mongoose);
    }
    await User.ensureIndexes();
  });

  // Disconnect after tests
  afterAll(async () => {
    await mongoose.disconnect();
  });

  // Clear collection before each test
  beforeEach(async () => {
    await User.deleteMany({});
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Required Fields
  // ══════════════════════════════════════════════════════════════════════════

  describe('Required Fields', () => {
    it('should reject user without email', async () => {
      const user = new User({
        hashedPassword: 'hash123',
      });

      await expect(user.save()).rejects.toThrow(/email.*required/i);
    });

    it('should reject user without hashedPassword', async () => {
      const user = new User({
        email: 'test@example.com',
      });

      await expect(user.save()).rejects.toThrow(/hashedPassword.*required/i);
    });

    it('should accept user with all required fields', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved).toBeDefined();
      expect(saved.email).toBe('test@example.com');
      expect(saved.hashedPassword).toBe('hash123');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // userId Generation and Uniqueness
  // ══════════════════════════════════════════════════════════════════════════

  describe('userId Field', () => {
    it('should auto-generate userId in format usr_XXXXXXXX', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.userId).toMatch(/^usr_[a-f0-9]+$/);
    });

    it('should generate unique userId for each user', async () => {
      const user1 = new User({
        email: 'user1@example.com',
        hashedPassword: 'hash123',
      });

      const user2 = new User({
        email: 'user2@example.com',
        hashedPassword: 'hash123',
      });

      const saved1 = await user1.save();
      const saved2 = await user2.save();

      expect(saved1.userId).not.toBe(saved2.userId);
    });

    it('should reject duplicate userId', async () => {
      const user1 = new User({
        userId: 'usr_duplicate',
        email: 'user1@example.com',
        hashedPassword: 'hash123',
      });

      await user1.save();

      const user2 = new User({
        userId: 'usr_duplicate',
        email: 'user2@example.com',
        hashedPassword: 'hash123',
      });

      await expect(user2.save()).rejects.toThrow(/duplicate key/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Email Field
  // ══════════════════════════════════════════════════════════════════════════

  describe('Email Field', () => {
    it('should normalize email to lowercase', async () => {
      const user = new User({
        email: 'Alice@EXAMPLE.COM',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.email).toBe('alice@example.com');
    });

    it('should trim email whitespace', async () => {
      const user = new User({
        email: '  test@example.com  ',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.email).toBe('test@example.com');
    });

    it('should reject duplicate email', async () => {
      const user1 = new User({
        email: 'duplicate@example.com',
        hashedPassword: 'hash123',
      });

      await user1.save();

      const user2 = new User({
        email: 'duplicate@example.com',
        hashedPassword: 'hash123',
      });

      await expect(user2.save()).rejects.toThrow(/duplicate key|E11000/);
    });

    it('should reject duplicate email regardless of case', async () => {
      const user1 = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      await user1.save();

      const user2 = new User({
        email: 'TEST@EXAMPLE.COM', // Different case
        hashedPassword: 'hash123',
      });

      await expect(user2.save()).rejects.toThrow(/duplicate key|E11000/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Role Field
  // ══════════════════════════════════════════════════════════════════════════

  describe('Role Field', () => {
    it('should default role to student', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.role).toBe('student');
    });

    it('should accept valid roles', async () => {
      const roles = ['student', 'professor', 'admin', 'coordinator'];

      for (const role of roles) {
        const user = new User({
          email: `test-${role}@example.com`,
          hashedPassword: 'hash123',
          role,
        });

        const saved = await user.save();
        expect(saved.role).toBe(role);
      }
    });

    it('should reject invalid role', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        role: 'invalid_role',
      });

      await expect(user.save()).rejects.toThrow(/not a valid enum value/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GitHub Fields
  // ══════════════════════════════════════════════════════════════════════════

  describe('GitHub Fields', () => {
    it('should default githubUsername to null', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.githubUsername).toBeNull();
    });

    it('should normalize githubUsername to lowercase', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        githubUsername: 'AliceGH',
      });

      const saved = await user.save();
      expect(saved.githubUsername).toBe('alicegh');
    });

    it('should trim githubUsername whitespace', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        githubUsername: '  alice-gh  ',
      });

      const saved = await user.save();
      expect(saved.githubUsername).toBe('alice-gh');
    });

    it('should allow multiple users with null githubUsername', async () => {
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

      expect(saved1.githubUsername).toBeNull();
      expect(saved2.githubUsername).toBeNull();
    });

    it('should reject duplicate githubUsername', async () => {
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

    it('should default githubId to null', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.githubId).toBeNull();
    });

    it('should store and retrieve githubId', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        githubId: '456789',
      });

      const saved = await user.save();
      expect(saved.githubId).toBe('456789');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Email Verification Fields
  // ══════════════════════════════════════════════════════════════════════════

  describe('Email Verification Fields', () => {
    it('should default emailVerified to false', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.emailVerified).toBe(false);
    });

    it('should allow setting emailVerified to true', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        emailVerified: true,
      });

      const saved = await user.save();
      expect(saved.emailVerified).toBe(true);
    });

    it('should store and clear emailVerificationToken', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        emailVerificationToken: 'token123',
      });

      let saved = await user.save();
      expect(saved.emailVerificationToken).toBe('token123');

      saved.emailVerificationToken = null;
      saved = await saved.save();
      expect(saved.emailVerificationToken).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Account Status Field
  // ══════════════════════════════════════════════════════════════════════════

  describe('Account Status Field', () => {
    it('should default accountStatus to pending', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.accountStatus).toBe('pending');
    });

    it('should accept valid account statuses', async () => {
      const statuses = ['pending', 'active', 'suspended'];

      for (const status of statuses) {
        const user = new User({
          email: `test-${status}@example.com`,
          hashedPassword: 'hash123',
          accountStatus: status,
        });

        const saved = await user.save();
        expect(saved.accountStatus).toBe(status);
      }
    });

    it('should reject invalid account status', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        accountStatus: 'invalid_status',
      });

      await expect(user.save()).rejects.toThrow(/not a valid enum value/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Timestamps
  // ══════════════════════════════════════════════════════════════════════════

  describe('Timestamps', () => {
    it('should auto-generate createdAt', async () => {
      const before = Date.now();
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      const after = Date.now();

      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(saved.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.createdAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('should auto-generate updatedAt', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.updatedAt).toBeInstanceOf(Date);
    });

    it('should update updatedAt on save', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved1 = await user.save();
      const updatedAt1 = saved1.updatedAt.getTime();

      // Wait a bit and update
      await new Promise(resolve => setTimeout(resolve, 10));

      saved1.emailVerified = true;
      const saved2 = await saved1.save();
      const updatedAt2 = saved2.updatedAt.getTime();

      expect(updatedAt2).toBeGreaterThan(updatedAt1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Optional Fields
  // ══════════════════════════════════════════════════════════════════════════

  describe('Optional Fields', () => {
    it('should allow studentId as optional field', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        studentId: 'STU-2025-001',
      });

      const saved = await user.save();
      expect(saved.studentId).toBe('STU-2025-001');
    });

    it('should default studentId to null', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.studentId).toBeNull();
    });

    it('should allow lastLogin as optional field', async () => {
      const now = new Date();
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        lastLogin: now,
      });

      const saved = await user.save();
      expect(saved.lastLogin).toBeInstanceOf(Date);
    });

    it('should default loginAttempts to 0', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.loginAttempts).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Indexes
  // ══════════════════════════════════════════════════════════════════════════

  describe('Indexes', () => {
    it('should have index on email', async () => {
      const indexes = await User.collection.getIndexes();
      const emailIndex = Object.values(indexes).find(idx => idx.key && idx.key.email === 1);
      expect(emailIndex).toBeDefined();
      expect(emailIndex.unique).toBe(true);
    });

    it('should have index on userId', async () => {
      const indexes = await User.collection.getIndexes();
      const userIdIndex = Object.values(indexes).find(idx => idx.key && idx.key.userId === 1);
      expect(userIdIndex).toBeDefined();
      expect(userIdIndex.unique).toBe(true);
    });

    it('should have index on githubId', async () => {
      const indexes = await User.collection.getIndexes();
      const githubIdIndex = Object.values(indexes).find(idx => idx.key && idx.key.githubId === 1);
      expect(githubIdIndex).toBeDefined();
    });

    it('should have partial unique index on githubUsername', async () => {
      const indexes = await User.collection.getIndexes();
      const githubUsernameIndex = Object.values(indexes).find(
        idx => idx.key && idx.key.githubUsername === 1
      );
      expect(githubUsernameIndex).toBeDefined();
      expect(githubUsernameIndex.unique).toBe(true);
      expect(githubUsernameIndex.partialFilterExpression).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // OpenAPI Compliance
  // ══════════════════════════════════════════════════════════════════════════

  describe('OpenAPI UserAccount Compliance', () => {
    it('should contain all required OpenAPI fields', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        role: 'student',
        githubUsername: 'test-gh',
        emailVerified: true,
        accountStatus: 'active',
      });

      const saved = await user.save();

      // Verify all OpenAPI required fields exist
      expect(saved.userId).toBeDefined();
      expect(saved.email).toBeDefined();
      expect(saved.role).toBeDefined();
      expect(saved.githubUsername).toBeDefined();
      expect(saved.emailVerified).toBeDefined();
      expect(saved.accountStatus).toBeDefined();
      expect(saved.createdAt).toBeDefined();
    });

    it('should return valid ISO 8601 createdAt timestamp', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      const iso = saved.createdAt.toISOString();

      // Verify ISO 8601 format
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Edge Cases
  // ══════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('should handle special characters in email', async () => {
      const user = new User({
        email: 'test+tag@example.co.uk',
        hashedPassword: 'hash123',
      });

      const saved = await user.save();
      expect(saved.email).toBe('test+tag@example.co.uk');
    });

    it('should handle special characters in githubUsername', async () => {
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        githubUsername: 'alice-bob_123',
      });

      const saved = await user.save();
      expect(saved.githubUsername).toBe('alice-bob_123');
    });

    it('should preserve token values without modification', async () => {
      const token = 'ab!cd@ef#gh$ij%kl^mn&op*qr(st)uv';
      const user = new User({
        email: 'test@example.com',
        hashedPassword: 'hash123',
        emailVerificationToken: token,
      });

      const saved = await user.save();
      expect(saved.emailVerificationToken).toBe(token);
    });
  });
});
