/**
 * E2E: Complete Student Registration Flow
 *
 * Tests the full end-to-end flow:
 *  1. Student ID validation (POST /onboarding/validate-student-id)
 *  2. Account registration (POST /auth/register)
 *  3. Email verification (POST /onboarding/send-verification-email → POST /onboarding/verify-email)
 *  4. Onboarding completion (POST /onboarding/complete)
 *
 * Verifies:
 *  ✓ Full workflow succeeds end-to-end
 *  ✓ All audit events logged correctly
 *  ✓ Account status transitions are correct
 *  ✓ Access control at each step
 *  ✓ Error handling at each step
 *
 * Run: npm test -- e2e-student-registration.test.js
 */

const mongoose = require('mongoose');
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const User = require('../src/models/User');
const StudentIdRegistry = require('../src/models/StudentIdRegistry');
const AuditLog = require('../src/models/AuditLog');

jest.mock('../src/services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  sendAccountReadyEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  _internal: { sendWithRetry: jest.fn(), isTransientError: jest.fn(), isDevMode: jest.fn(), createTransporter: jest.fn() },
}));

const { sendVerificationEmail, sendAccountReadyEmail } = require('../src/services/emailService');

const MONGO_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-e2e-student';

describe('E2E: Complete Student Registration Flow', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(MONGO_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await StudentIdRegistry.deleteMany({});
    await AuditLog.deleteMany({});
    jest.clearAllMocks();
  });

  /**
   * STEP 1: Validate Student ID
   */
  describe('Step 1: Student ID Validation', () => {
    it('should validate a valid student ID', async () => {
      // Pre-setup: Create student ID in registry
      await StudentIdRegistry.create({
        studentId: 'A00123456',
        email: 'john.doe@university.edu',
        name: 'John Doe',
        uploadBatchId: 'batch_001',
      });

      const res = await request(app)
        .post('/api/v1/onboarding/validate-student-id')
        .send({
          studentId: 'A00123456',
          email: 'john.doe@university.edu',
        });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.validationToken).toBeTruthy();
      expect(res.body.expiresIn).toBe(600); // 10 minutes
    });

    it('should reject invalid student ID', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/validate-student-id')
        .send({
          studentId: 'INVALID',
          email: 'invalid@university.edu',
        });

      expect(res.status).toBe(422);
    });
  });

  /**
   * STEP 2: Register with Validation Token
   */
  describe('Step 2: Account Registration', () => {
    it('should register account with valid token', async () => {
      // Setup: Create student ID and get validation token
      await StudentIdRegistry.create({
        studentId: 'B00654321',
        email: 'jane.smith@university.edu',
        name: 'Jane Smith',
        uploadBatchId: 'batch_001',
      });

      const validateRes = await request(app)
        .post('/api/v1/onboarding/validate-student-id')
        .send({
          studentId: 'B00654321',
          email: 'jane.smith@university.edu',
        });

      expect(validateRes.status).toBe(200);
      const validationToken = validateRes.body.validationToken;

      // Register account
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          validationToken,
          password: 'SecurePass@123',
          email: 'jane.smith@university.edu',
        });

      expect(registerRes.status).toBe(201);
      expect(registerRes.body.userId).toBeTruthy();
      expect(registerRes.body.accessToken).toBeTruthy();
      expect(registerRes.body.refreshToken).toBeTruthy();

      // Verify user in database
      const user = await User.findOne({ email: 'jane.smith@university.edu' });
      expect(user).toBeTruthy();
      expect(user.accountStatus).toBe('pending_verification');
      expect(user.emailVerified).toBe(false);

      // Verify audit log
      const auditLog = await AuditLog.findOne({ targetId: user.userId, action: 'ACCOUNT_CREATED' });
      expect(auditLog).toBeTruthy();
    });

    it('should reject invalid validation token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          validationToken: 'invalid.token.here',
          password: 'SecurePass@123',
          email: 'test@university.edu',
        });

      expect(res.status).toBe(401);
    });

    it('should reject expired validation token', async () => {
      // Create a JWT with expiry in past
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        {
          studentId: 'C00999999',
          email: 'expired@university.edu',
          type: 'student_id_validation',
          exp: Math.floor(Date.now() / 1000) - 60, // Expired 60 seconds ago
        },
        process.env.JWT_SECRET || 'test-secret'
      );

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          validationToken: expiredToken,
          password: 'SecurePass@123',
          email: 'expired@university.edu',
        });

      expect(res.status).toBe(401);
    });
  });

  /**
   * STEP 3: Send and Verify Email
   */
  describe('Step 3: Email Verification', () => {
    it('should send verification email to registered user', async () => {
      // Setup: Create registered user
      const user = await User.create({
        email: 'verify.me@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: false,
      });

      // Generate auth token
      const { generateTokenPair } = require('../src/utils/jwt');
      const { accessToken } = generateTokenPair(user.userId, user.role);

      const res = await request(app)
        .post('/api/v1/onboarding/send-verification-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      expect(res.status).toBe(200);
      expect(res.body.retryAfter).toBe(60);
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        user.email,
        expect.any(String),
        user.userId
      );

      // Verify token was stored
      const updatedUser = await User.findOne({ userId: user.userId });
      expect(updatedUser.emailVerificationToken).toBeTruthy();
      expect(updatedUser.emailVerificationTokenExpiry).toBeTruthy();
    });

    it('should verify email with valid token', async () => {
      // Setup: Create user with verification token
      const token = crypto.randomBytes(32).toString('hex');
      const user = await User.create({
        email: 'verify@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: false,
        emailVerificationToken: token,
        emailVerificationTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/v1/onboarding/verify-email')
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.emailVerified).toBe(true);

      // Verify in database
      const updated = await User.findOne({ userId: user.userId });
      expect(updated.emailVerified).toBe(true);
      expect(updated.emailVerificationToken).toBeNull();
    });

    it('should reject expired verification token', async () => {
      const expiredToken = crypto.randomBytes(32).toString('hex');
      await User.create({
        email: 'expired.verify@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: false,
        emailVerificationToken: expiredToken,
        emailVerificationTokenExpiry: new Date(Date.now() - 1000), // Expired
      });

      const res = await request(app)
        .post('/api/v1/onboarding/verify-email')
        .send({ token: expiredToken });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EXPIRED_TOKEN');
    });
  });

  /**
   * STEP 4: Complete Onboarding
   */
  describe('Step 4: Onboarding Completion', () => {
    it('should complete onboarding when email is verified', async () => {
      // Setup: Create verified student
      const user = await User.create({
        email: 'complete@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: true,
      });

      const { generateTokenPair } = require('../src/utils/jwt');
      const { accessToken } = generateTokenPair(user.userId, user.role);

      const res = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      expect(res.status).toBe(200);
      expect(res.body.accountStatus).toBe('active');
      expect(sendAccountReadyEmail).toHaveBeenCalledWith(
        user.email,
        'student',
        user.userId
      );

      // Verify audit log
      const auditLog = await AuditLog.findOne({
        targetId: user.userId,
        action: 'ONBOARDING_COMPLETED',
      });
      expect(auditLog).toBeTruthy();
    });

    it('should reject onboarding before email verification', async () => {
      const user = await User.create({
        email: 'incomplete@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: false,
      });

      const { generateTokenPair } = require('../src/utils/jwt');
      const { accessToken } = generateTokenPair(user.userId, user.role);

      const res = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PREREQUISITES_NOT_MET');
    });

    it('should be idempotent (account already active)', async () => {
      const user = await User.create({
        email: 'already.active@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
      });

      const { generateTokenPair } = require('../src/utils/jwt');
      const { accessToken } = generateTokenPair(user.userId, user.role);

      const res = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      expect(res.status).toBe(200);
      expect(res.body.accountStatus).toBe('active');
      // Email should not be sent when already active
      expect(sendAccountReadyEmail).not.toHaveBeenCalled();
    });
  });

  /**
   * FULL END-TO-END FLOW
   */
  describe('Complete E2E Workflow', () => {
    it('should complete full student registration flow successfully', async () => {
      // 1. Setup student ID
      await StudentIdRegistry.create({
        studentId: 'E2E00001',
        email: 'e2e.student@university.edu',
        name: 'E2E Student',
        uploadBatchId: 'batch_001',
      });

      // 2. Validate student ID
      const validateRes = await request(app)
        .post('/api/v1/onboarding/validate-student-id')
        .send({
          studentId: 'E2E00001',
          email: 'e2e.student@university.edu',
        });
      expect(validateRes.status).toBe(200);
      const validationToken = validateRes.body.validationToken;

      // 3. Register account
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          validationToken,
          password: 'SecurePass@123',
          email: 'e2e.student@university.edu',
        });
      expect(registerRes.status).toBe(201);
      const userId = registerRes.body.userId;
      const accessToken = registerRes.body.accessToken;

      // Verify account created
      let user = await User.findOne({ userId });
      expect(user.accountStatus).toBe('pending_verification');
      expect(user.emailVerified).toBe(false);

      // 4. Send verification email
      const sendRes = await request(app)
        .post('/api/v1/onboarding/send-verification-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId });
      expect(sendRes.status).toBe(200);

      // Get verification token
      user = await User.findOne({ userId });
      const verificationToken = user.emailVerificationToken;
      expect(verificationToken).toBeTruthy();

      // 5. Verify email
      const verifyRes = await request(app)
        .post('/api/v1/onboarding/verify-email')
        .send({ token: verificationToken });
      expect(verifyRes.status).toBe(200);

      // 6. Complete onboarding
      const completeRes = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId });
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.accountStatus).toBe('active');

      // 7. Verify final state
      user = await User.findOne({ userId });
      expect(user.accountStatus).toBe('active');
      expect(user.emailVerified).toBe(true);

      // 8. Verify audit logs (ACCOUNT_CREATED and ONBOARDING_COMPLETED)
      // Note: EMAIL_VERIFIED is not logged by the backend
      const logs = await AuditLog.find({ targetId: userId });
      expect(logs.length).toBeGreaterThanOrEqual(2);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('ACCOUNT_CREATED');
      expect(actions).toContain('ONBOARDING_COMPLETED');
    });

    it('should handle network/email failures gracefully', async () => {
      sendVerificationEmail.mockRejectedValueOnce(new Error('Network timeout'));

      const user = await User.create({
        email: 'network.test@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: false,
      });

      const { generateTokenPair } = require('../src/utils/jwt');
      const { accessToken } = generateTokenPair(user.userId, user.role);

      const res = await request(app)
        .post('/api/v1/onboarding/send-verification-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      // Should handle gracefully (5xx error or service degraded)
      expect([500, 503]).toContain(res.status);
    });
  });

  /**
   * ACCESS CONTROL TESTS
   */
  describe('Access Control', () => {
    it('should deny access without authorization token', async () => {
      const user = await User.create({
        email: 'noauth@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
      });

      const res = await request(app)
        .post('/api/v1/onboarding/send-verification-email')
        .send({ userId: user.userId });

      expect(res.status).toBe(401);
    });

    it('should handle rate limiting on email verification requests', async () => {
      const user = await User.create({
        email: 'ratelimit@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'pending_verification',
        emailVerified: false,
      });

      const { generateTokenPair } = require('../src/utils/jwt');
      const { accessToken } = generateTokenPair(user.userId, user.role);

      // First request should succeed
      const res1 = await request(app)
        .post('/api/v1/onboarding/send-verification-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      expect(res1.status).toBe(200);

      // Second request within cooldown window should be rate limited  
      const res2 = await request(app)
        .post('/api/v1/onboarding/send-verification-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: user.userId });

      expect(res2.status).toBe(429);
      expect(res2.body.code).toBe('RATE_LIMITED');
    });
  });
});
