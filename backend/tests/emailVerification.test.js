/**
 * Email Verification Integration Tests
 *
 * Tests for POST /onboarding/send-verification-email and POST /onboarding/verify-email.
 * Covers: rate limiting (1/min, 5/24h), token expiry, already-verified, invalid token.
 *
 * Run: npm test -- emailVerification.test.js
 */

const mongoose = require('mongoose');
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const User = require('../src/models/User');
const { generateTokenPair } = require('../src/utils/jwt');

// Suppress email console output during tests
jest.mock('../src/services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', recipient: 'test@example.com', status: 'sent' }),
  sendAccountReadyEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
}));

const MONGO_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test';

const createUser = async (overrides = {}) => {
  return User.create({
    email: `test-${Date.now()}@example.com`,
    hashedPassword: 'hashed',
    role: 'student',
    accountStatus: 'pending',
    emailVerified: false,
    ...overrides,
  });
};

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
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /onboarding/send-verification-email
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /onboarding/send-verification-email', () => {
  it('sends verification email and returns retryAfter', async () => {
    const user = await createUser();

    const res = await request(app)
      .post('/api/v1/onboarding/send-verification-email')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(200);
    expect(res.body.retryAfter).toBe(60);

    const updated = await User.findOne({ userId: user.userId });
    expect(updated.emailVerificationToken).toBeTruthy();
    expect(updated.emailVerificationSentCount).toBe(1);
  });

  it('returns ALREADY_VERIFIED when email is already verified', async () => {
    const user = await createUser({ emailVerified: true });

    const res = await request(app)
      .post('/api/v1/onboarding/send-verification-email')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('ALREADY_VERIFIED');
  });

  it('returns 429 RATE_LIMITED if called within 1 minute', async () => {
    const user = await createUser({
      emailVerificationLastSentAt: new Date(), // just sent
    });

    const res = await request(app)
      .post('/api/v1/onboarding/send-verification-email')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it('returns 429 MAX_EMAILS_REACHED after 5 emails in 24h', async () => {
    const user = await createUser({
      emailVerificationSentCount: 5,
      emailVerificationWindowStart: new Date(),
      emailVerificationLastSentAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago (cooldown passed)
    });

    const res = await request(app)
      .post('/api/v1/onboarding/send-verification-email')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('MAX_EMAILS_REACHED');
  });

  it('resets 24h window and allows send after window expires', async () => {
    const user = await createUser({
      emailVerificationSentCount: 5,
      emailVerificationWindowStart: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago
      emailVerificationLastSentAt: new Date(Date.now() - 2 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/v1/onboarding/send-verification-email')
      .set('Authorization', authHeader(user))
      .send({ userId: user.userId });

    expect(res.status).toBe(200);
    const updated = await User.findOne({ userId: user.userId });
    expect(updated.emailVerificationSentCount).toBe(1);
  });

  it('returns 400 when userId is missing', async () => {
    const user = await createUser();

    const res = await request(app)
      .post('/api/v1/onboarding/send-verification-email')
      .set('Authorization', authHeader(user))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /onboarding/verify-email
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /onboarding/verify-email', () => {
  it('verifies a valid token and marks emailVerified', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/v1/onboarding/verify-email')
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
  });

  it('returns 400 EXPIRED_TOKEN for an expired token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() - 1000), // already expired
    });

    const res = await request(app)
      .post('/api/v1/onboarding/verify-email')
      .send({ token });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EXPIRED_TOKEN');
  });

  it('returns 400 INVALID_TOKEN for a non-existent token', async () => {
    const res = await request(app)
      .post('/api/v1/onboarding/verify-email')
      .send({ token: 'totally-wrong-token' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns ALREADY_VERIFIED when user is already verified', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await createUser({
      emailVerified: true,
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/v1/onboarding/verify-email')
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('ALREADY_VERIFIED');
  });

  it('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/api/v1/onboarding/verify-email')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });
});
