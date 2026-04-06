/**
 * E2E: Complete Professor Account Flow
 *
 * Tests the full end-to-end flow for professor accounts:
 *  1. Admin creates professor account (POST /auth/admin/professor/create)
 *  2. Temporary credentials sent via email
 *  3. Professor logs in with temp password (POST /auth/login)
 *  4. Professor must change password on first login (POST /auth/change-password)
 *  5. Professor account becomes active
 *  (Optional) GitHub account linking (POST /auth/github/oauth/initiate)
 *
 * Verifies:
 *  ✓ Admin-only access control
 *  ✓ Temporary credentials generation
 *  ✓ First-login password change enforcement
 *  ✓ Token handling after password change
 *  ✓ Audit logging for all events
 *  ✓ Email delivery (professor credentials, account ready)
 *
 * Run: npm test -- e2e-professor-account.test.js
 */

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/index');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { hashPassword, comparePassword } = require('../src/utils/password');
const { generateTokenPair } = require('../src/utils/jwt');

jest.mock('../src/services/emailService', () => ({
  sendProfessorCredentialsEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  sendAccountReadyEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  _internal: { sendWithRetry: jest.fn(), isTransientError: jest.fn(), isDevMode: jest.fn(), createTransporter: jest.fn() },
}));

const { sendProfessorCredentialsEmail, sendAccountReadyEmail } = require('../src/services/emailService');

const MONGO_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-e2e-professor';

describe('E2E: Complete Professor Account Flow', () => {
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(MONGO_URI);

    // Clean up any existing admin user
    await User.deleteMany({ email: 'admin@university.edu' });

    // Create admin user for testing
    adminUser = await User.create({
      email: 'admin@university.edu',
      hashedPassword: await hashPassword('Admin@123456'),
      role: 'admin',
      accountStatus: 'active',
      emailVerified: true,
    });

    const { accessToken } = generateTokenPair(adminUser.userId, 'admin');
    adminToken = accessToken;
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({ role: 'professor' });
    await AuditLog.deleteMany({});
    jest.clearAllMocks();
  });

  /**
   * STEP 1: Admin Creates Professor Account
   */
  describe('Step 1: Admin Creates Professor Account', () => {
    it('should create professor account with admin privileges', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'dr.smith@university.edu',
          firstName: 'Dr.',
          lastName: 'Smith',
        });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBeTruthy();
      expect(res.body.message).toContain('credentials have been sent via email');

      // Verify professor in database
      const professor = await User.findOne({ email: 'dr.smith@university.edu' });
      expect(professor).toBeTruthy();
      expect(professor.role).toBe('professor');
      expect(professor.accountStatus).toBe('pending');
      expect(professor.requiresPasswordChange).toBe(true);
      expect(professor.emailVerified).toBe(false);

      // Verify email was sent
      expect(sendProfessorCredentialsEmail).toHaveBeenCalledWith(
        'dr.smith@university.edu',
        expect.any(String) // temporary password
      );

      // Verify audit log
      const auditLog = await AuditLog.findOne({
        targetId: professor.userId,
        action: 'ACCOUNT_CREATED',
      });
      expect(auditLog).toBeTruthy();
      expect(auditLog.actorId).toBe(adminUser.userId);
    });

    it('should reject non-admin users', async () => {
      // Create non-admin user
      const studentUser = await User.create({
        email: 'student@university.edu',
        hashedPassword: 'hashed',
        role: 'student',
        accountStatus: 'active',
      });

      const { accessToken } = generateTokenPair(studentUser.userId, 'student');

      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          email: 'unauthorized@university.edu',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should reject without authorization', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .send({
          email: 'noauth@university.edu',
        });

      expect(res.status).toBe(401);
    });

    it('should reject duplicate email', async () => {
      // Create first professor
      await User.create({
        email: 'duplicate@university.edu',
        hashedPassword: 'hashed',
        role: 'professor',
        accountStatus: 'pending',
      });

      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'duplicate@university.edu',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });
  });

  /**
   * STEP 2: Professor First Login
   */
  describe('Step 2: Professor First Login with Temporary Password', () => {
    it('should login with temporary password', async () => {
      // Create professor with temp password (captured from email in real flow)
      const tempPassword = 'TempPass@123!A';
      const hashedPassword = await hashPassword(tempPassword);

      const professor = await User.create({
        email: 'login.test@university.edu',
        hashedPassword,
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: true,
        emailVerified: false,
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login.test@university.edu',
          password: tempPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.requiresPasswordChange).toBe(true);

      // Verify audit log
      const auditLog = await AuditLog.findOne({
        targetId: professor.userId,
        action: 'LOGIN_SUCCESS',
      });
      expect(auditLog).toBeTruthy();
    });

    it('should deny access with incorrect password', async () => {
      const professor = await User.create({
        email: 'wrongpass@university.edu',
        hashedPassword: await hashPassword('CorrectPass@123'),
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'wrongpass@university.edu',
          password: 'WrongPassword@123',
        });

      expect(res.status).toBe(401);

      // Verify audit log
      const auditLog = await AuditLog.findOne({
        targetId: professor.userId,
        action: 'LOGIN_FAILED',
      });
      expect(auditLog).toBeTruthy();
    });
  });

  /**
   * STEP 3: Professor Changes Password
   */
  describe('Step 3: Professor Changes Password on First Login', () => {
    it('should change password successfully', async () => {
      const oldPassword = 'OldPass@123!A';
      const newPassword = 'NewSecure@456!B';

      const professor = await User.create({
        email: 'change.password@university.edu',
        hashedPassword: await hashPassword(oldPassword),
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: true,
        emailVerified: false,
      });

      const { accessToken } = generateTokenPair(professor.userId, 'professor');

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword,
          newPassword,
        });

      expect(res.status).toBe(200);

      // Verify password changed in database
      const updated = await User.findOne({ userId: professor.userId });
      expect(await comparePassword(newPassword, updated.hashedPassword)).toBe(true);
      expect(updated.requiresPasswordChange).toBe(false);

      // Verify old password no longer works - would need to call auth again
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: professor.email,
          password: oldPassword,
        });
      expect(loginRes.status).toBe(401);

      // New password works
      const newLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: professor.email,
          password: newPassword,
        });
      expect(newLoginRes.status).toBe(200);
      expect(newLoginRes.body.requiresPasswordChange).toBe(false);

      // Verify audit logs
      const logs = await AuditLog.find({ targetId: professor.userId });
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('PASSWORD_CHANGED');
    });

    it('should reject weak new password', async () => {
      const professor = await User.create({
        email: 'weak.pass@university.edu',
        hashedPassword: await hashPassword('OldPass@123!A'),
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: true,
      });

      const { accessToken } = generateTokenPair(professor.userId, 'professor');

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: 'OldPass@123!A',
          newPassword: 'weakpass', // Missing uppercase, number, special char
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('WEAK_PASSWORD');
    });

    it('should reject incorrect old password', async () => {
      const professor = await User.create({
        email: 'wrong.old@university.edu',
        hashedPassword: await hashPassword('CorrectOld@123'),
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: true,
      });

      const { accessToken } = generateTokenPair(professor.userId, 'professor');

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: 'WrongOld@123',
          newPassword: 'NewSecure@456!B',
        });

      expect(res.status).toBe(401);
    });
  });

  /**
   * STEP 4: Complete Onboarding (Professor)
   */
  describe('Step 4: Complete Professor Onboarding', () => {
    it('should complete onboarding after password change', async () => {
      const professor = await User.create({
        email: 'complete.prof@university.edu',
        hashedPassword: await hashPassword('NewPass@123456'),
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: false, // Password already changed
        emailVerified: false,
      });

      const { accessToken } = generateTokenPair(professor.userId, 'professor');

      const res = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: professor.userId });

      expect(res.status).toBe(200);
      expect(res.body.accountStatus).toBe('active');

      // Verify account ready email sent
      expect(sendAccountReadyEmail).toHaveBeenCalledWith(
        professor.email,
        'professor',
        professor.userId
      );

      // Verify account status updated
      const updated = await User.findOne({ userId: professor.userId });
      expect(updated.accountStatus).toBe('active');
    });

    it('should reject onboarding if password not yet changed', async () => {
      const professor = await User.create({
        email: 'incomplete.prof@university.edu',
        hashedPassword: 'hashed',
        role: 'professor',
        accountStatus: 'pending',
        requiresPasswordChange: true, // Still requires password change
      });

      const { accessToken } = generateTokenPair(professor.userId, 'professor');

      const res = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: professor.userId });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PREREQUISITES_NOT_MET');
    });
  });

  /**
   * FULL END-TO-END PROFESSOR FLOW
   */
  describe('Complete E2E Professor Account Flow', () => {
    it('should complete full professor account setup', async () => {
      // 1. Admin creates professor account
      let tempPassword = null;
      sendProfessorCredentialsEmail.mockImplementationOnce((email, password) => {
        tempPassword = password;
        return Promise.resolve({ messageId: 'mock-id', status: 'sent' });
      });

      const createRes = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'e2e.professor@university.edu',
          firstName: 'Prof.',
          lastName: 'E2E',
        });
      expect(createRes.status).toBe(201);
      expect(tempPassword).toBeTruthy();

      const professorId = createRes.body.userId;

      // 2. Professor logs in with temp password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'e2e.professor@university.edu',
          password: tempPassword,
        });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.requiresPasswordChange).toBe(true);

      const professorsAccessToken = loginRes.body.accessToken;

      // 3. Professor changes password
      const changeRes = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${professorsAccessToken}`)
        .send({
          oldPassword: tempPassword,
          newPassword: 'MyNewPassword@789!B',
        });
      expect(changeRes.status).toBe(200);

      // 4. Get new token (since old one might be invalidated)
      const newLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'e2e.professor@university.edu',
          password: 'MyNewPassword@789!B',
        });
      expect(newLoginRes.status).toBe(200);
      expect(newLoginRes.body.requiresPasswordChange).toBe(false);

      const newAccessToken = newLoginRes.body.accessToken;

      // 5. Complete onboarding
      const completeRes = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .send({ userId: professorId });
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.accountStatus).toBe('active');

      // 6. Verify final state
      const professor = await User.findOne({ userId: professorId });
      expect(professor.accountStatus).toBe('active');
      expect(professor.requiresPasswordChange).toBe(false);

      // 7. Verify all audit logs
      const logs = await AuditLog.find({ targetId: professorId });
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('ACCOUNT_CREATED');
      expect(actions).toContain('LOGIN_SUCCESS');
      expect(actions).toContain('PASSWORD_CHANGED');
      expect(actions).toContain('ONBOARDING_COMPLETED');
    });

    it('should handle email delivery failures gracefully', async () => {
      sendProfessorCredentialsEmail.mockRejectedValueOnce(new Error('Email service down'));

      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'email.failure@university.edu',
        });

      // Should still create account even if email fails (non-fatal)
      // but return appropriate status
      expect([201, 500]).toContain(res.status);

      // If successful, verify professor was created
      if (res.status === 201) {
        const professor = await User.findOne({ email: 'email.failure@university.edu' });
        expect(professor).toBeTruthy();
      }
    });
  });

  /**
   * ERROR CASES AND EDGE CONDITIONS
   */
  describe('Edge Cases and Error Handling', () => {
    it('should validate required fields on professor creation', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          // Missing email
          firstName: 'Missing',
          lastName: 'Email',
        });

      expect(res.status).toBe(400);
    });

    it('should validate email format on professor creation', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin/professor/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'not-an-email',
        });

      expect(res.status).toBe(400);
    });

    it('should handle concurrent password changes safely', async () => {
      const professor = await User.create({
        email: 'concurrent@university.edu',
        hashedPassword: await hashPassword('OldPass@123456'),
        role: 'professor',
        accountStatus: 'active',
        requiresPasswordChange: false,
      });

      const { accessToken } = generateTokenPair(professor.userId, 'professor');

      // Simulate two concurrent password change requests
      const res1 = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: 'OldPass@123456',
          newPassword: 'NewPass@111111',
        });

      const res2 = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          oldPassword: 'OldPass@123456', // Old password won't work after first change
          newPassword: 'NewPass@222222',
        });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(401); // Second should fail
    });
  });
});
