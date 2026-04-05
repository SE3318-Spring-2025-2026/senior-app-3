/**
 * Onboarding Completion Integration Tests
 *
 * Tests for POST /onboarding/complete (flows f16, f21, f22, f23, f24).
 * Covers: student email-verified flow, professor password-set flow,
 *         idempotency, prerequisites not met, 404, auth guard, audit logging.
 *
 * Run: npm test -- onboarding.complete.test.js
 */

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/index');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { generateTokenPair } = require('../src/utils/jwt');

jest.mock('../src/services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  sendAccountReadyEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  sendProfessorCredentialsEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
  _internal: { sendWithRetry: jest.fn(), isTransientError: jest.fn(), isDevMode: jest.fn(), createTransporter: jest.fn() },
}));

const { sendAccountReadyEmail } = require('../src/services/emailService');

const MONGO_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test';

const createStudent = (overrides = {}) =>
  User.create({
    email: `student-${Date.now()}-${Math.random()}@example.com`,
    hashedPassword: 'hashed',
    role: 'student',
    accountStatus: 'pending_verification',
    emailVerified: false,
    ...overrides,
  });

const createProfessor = (overrides = {}) =>
  User.create({
    email: `prof-${Date.now()}-${Math.random()}@example.com`,
    hashedPassword: 'hashed',
    role: 'professor',
    accountStatus: 'pending',
    emailVerified: false,
    requiresPasswordChange: true,
    ...overrides,
  });

const authHeader = (user) => {
  const { accessToken } = generateTokenPair(user.userId, user.role);
  return `Bearer ${accessToken}`;
};

beforeAll(async () => {
  await mongoose.connect(MONGO_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
  await AuditLog.deleteMany({});
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Student email-verified flow (f16 → f22 → f23)
// ─────────────────────────────────────────────────────────────────────────────

describe('student email-verified flow (f16)', () => {
  it('activates account, audits completion, and sends student account-ready email', async () => {
    const user = await createStudent({ emailVerified: true });

    const res = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('active');
    expect(res.body.userId).toBe(user.userId);
    expect(res.body.role).toBe('student');

    expect(sendAccountReadyEmail).toHaveBeenCalledTimes(1);
    expect(sendAccountReadyEmail).toHaveBeenCalledWith(user.email, 'student', user.userId);

    const audit = await AuditLog.findOne({ targetId: user.userId, action: 'ONBOARDING_COMPLETED' });
    expect(audit).not.toBeNull();
    expect(audit.changes.role).toBe('student');
    expect(audit.changes.newStatus).toBe('active');
  });

  it('returns 400 PREREQUISITES_NOT_MET when student email is not verified', async () => {
    const user = await createStudent({ emailVerified: false });

    const res = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PREREQUISITES_NOT_MET');
    expect(sendAccountReadyEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Professor password-set flow (f21 → f22 → f24)
// ─────────────────────────────────────────────────────────────────────────────

describe('professor password-set flow (f21)', () => {
  it('activates account, audits completion, and sends professor account-ready email', async () => {
    const prof = await createProfessor({ requiresPasswordChange: false });

    const res = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Authorization', authHeader(prof))
      .send({ userId: prof.userId });

    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('active');
    expect(res.body.role).toBe('professor');

    expect(sendAccountReadyEmail).toHaveBeenCalledTimes(1);
    expect(sendAccountReadyEmail).toHaveBeenCalledWith(prof.email, 'professor', prof.userId);

    const audit = await AuditLog.findOne({ targetId: prof.userId, action: 'ONBOARDING_COMPLETED' });
    expect(audit).not.toBeNull();
    expect(audit.changes.role).toBe('professor');
  });

  it('returns 400 PREREQUISITES_NOT_MET when professor has not set their password yet', async () => {
    const prof = await createProfessor({ requiresPasswordChange: true });

    const res = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Authorization', authHeader(prof))
      .send({ userId: prof.userId });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PREREQUISITES_NOT_MET');
    expect(sendAccountReadyEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency — notification sent only once per account
// ─────────────────────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('returns current state without resending email when account is already active', async () => {
    const user = await createStudent({ emailVerified: true, accountStatus: 'active' });

    const res = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('active');
    expect(sendAccountReadyEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

it('returns 400 MISSING_FIELDS when userId is omitted', async () => {
  const user = await createStudent();

  const res = await request(app)
    .post('/api/v1/onboarding/complete')
    .set('Authorization', authHeader(user))
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('MISSING_FIELDS');
});

it('returns 404 NOT_FOUND for an unknown userId', async () => {
  const user = await createStudent({ emailVerified: true });

  const res = await request(app)
    .post('/api/v1/onboarding/complete')
    .set('Authorization', authHeader(user))
    .send({ userId: 'usr_doesnotexist' });

  expect(res.status).toBe(404);
  expect(res.body.code).toBe('NOT_FOUND');
});

it('returns 401 when no auth token is provided', async () => {
  const res = await request(app)
    .post('/api/v1/onboarding/complete')
    .send({ userId: 'usr_whatever' });

  expect(res.status).toBe(401);
});
