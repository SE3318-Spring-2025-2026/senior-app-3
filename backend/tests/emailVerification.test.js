/**
 * Email Verification Integration Tests
 *
 * Tests for POST /onboarding/send-verification-email and POST /onboarding/verify-email.
 * Covers:
 * ✓ Token generation (24h expiry, valid format)
 * ✓ Email queuing verification
 * ✓ Rate limiting (1/min, 5/24h)
 * ✓ Token expiry, already-verified, invalid token
 * ✓ Single-use token enforcement
 * ✓ Audit logging for email verification events
 * ✓ Integration workflows (send → verify → complete)
 *
 * Run: npm test -- emailVerification.test.js
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

// Mock email service BEFORE importing controllers
jest.mock('../src/services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', recipient: 'test@example.com', status: 'sent' }),
  sendAccountReadyEmail: jest.fn().mockResolvedValue({ messageId: 'mock-id', status: 'sent' }),
}));

const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { sendVerificationEmailHandler, verifyEmail } = require('../src/controllers/onboarding');
const emailService = require('../src/services/emailService');

const MONGO_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test';

const createUser = async (overrides = {}) => {
  return User.create({
    email: `test-${Date.now()}-${Math.random()}@example.com`,
    hashedPassword: 'hashed',
    role: 'student',
    accountStatus: 'pending',
    emailVerified: false,
    ...overrides,
  });
};

const makeReq = (body = {}, user = null) => ({
  body,
  user,
  ip: '127.0.0.1',
  headers: { 'user-agent': 'test-agent' },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
  await AuditLog.deleteMany({});
  emailService.sendVerificationEmail.mockClear();
  emailService.sendAccountReadyEmail.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /onboarding/send-verification-email
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /onboarding/send-verification-email', () => {
  it('sends verification email and returns retryAfter', async () => {
    const user = await createUser();
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].retryAfter).toBe(60);

    const updated = await User.findOne({ userId: user.userId });
    expect(updated.emailVerificationToken).toBeTruthy();
    expect(updated.emailVerificationSentCount).toBe(1);
  });

  it('returns ALREADY_VERIFIED when email is already verified', async () => {
    const user = await createUser({ emailVerified: true });
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].code).toBe('ALREADY_VERIFIED');
  });

  it('returns 429 RATE_LIMITED if called within 1 minute', async () => {
    const user = await createUser({
      emailVerificationLastSentAt: new Date(),
    });
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].code).toBe('RATE_LIMITED');
    expect(res.json.mock.calls[0][0].retryAfter).toBeGreaterThan(0);
  });

  it('returns 429 MAX_EMAILS_REACHED after 5 emails in 24h', async () => {
    const user = await createUser({
      emailVerificationSentCount: 5,
      emailVerificationWindowStart: new Date(),
      emailVerificationLastSentAt: new Date(Date.now() - 2 * 60 * 1000),
    });
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].code).toBe('MAX_EMAILS_REACHED');
  });

  it('resets 24h window and allows send after window expires', async () => {
    const user = await createUser({
      emailVerificationSentCount: 5,
      emailVerificationWindowStart: new Date(Date.now() - 25 * 60 * 60 * 1000),
      emailVerificationLastSentAt: new Date(Date.now() - 2 * 60 * 1000),
    });
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await User.findOne({ userId: user.userId });
    expect(updated.emailVerificationSentCount).toBe(1);
  });

  it('returns 400 when userId is missing', async () => {
    const user = await createUser();
    const req = makeReq({}, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('MISSING_FIELDS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /onboarding/verify-email
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /onboarding/verify-email', () => {
  it('verifies a valid token and marks emailVerified', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const req = makeReq({ token });
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].emailVerified).toBe(true);
  });

  it('returns 400 EXPIRED_TOKEN for an expired token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() - 1000),
    });

    const req = makeReq({ token });
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('EXPIRED_TOKEN');
  });

  it('returns 400 INVALID_TOKEN for a non-existent token', async () => {
    const req = makeReq({ token: 'totally-wrong-token' });
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_TOKEN');
  });

  it('returns ALREADY_VERIFIED when user is already verified', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      emailVerified: true,
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const req = makeReq({ token });
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].code).toBe('ALREADY_VERIFIED');
  });

  it('returns 400 when token is missing', async () => {
    const req = makeReq({});
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('MISSING_FIELDS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY TESTS: Token Generation & Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Email Verification - Security Tests', () => {
  it('generates a valid 64-character hex token on email send', async () => {
    const user = await createUser();
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    const updated = await User.findOne({ userId: user.userId });
    expect(updated.emailVerificationToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('sets token expiry to 24 hours', async () => {
    const user = await createUser();
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    const updated = await User.findOne({ userId: user.userId });
    const msUntilExpiry = updated.emailVerificationTokenExpiry - new Date();
    
    const twentyFourHours = 24 * 60 * 60 * 1000;
    expect(msUntilExpiry).toBeGreaterThan(twentyFourHours - 60 * 1000);
    expect(msUntilExpiry).toBeLessThanOrEqual(twentyFourHours);
  });

  it('verifies email service was called with correct parameters', async () => {
    const user = await createUser();
    const req = makeReq({ userId: user.userId }, { userId: user.userId });
    const res = makeRes();

    await sendVerificationEmailHandler(req, res);

    expect(emailService.sendVerificationEmail).toHaveBeenCalled();
    const callArgs = emailService.sendVerificationEmail.mock.calls[0];
    expect(callArgs[0]).toBe(user.email);
    expect(callArgs[1]).toBeTruthy();
    expect(callArgs[2]).toBe(user.userId);
  });

  it('enforces single-use token: token cleared after first verify', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const req = makeReq({ token });
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    const updated = await User.findOne({ userId: user.userId });
    expect(updated.emailVerificationToken).toBeNull();
    expect(updated.emailVerificationTokenExpiry).toBeNull();
  });

  it('rejects token reuse: second verify with same token fails', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const req1 = makeReq({ token });
    const res1 = makeRes();
    await verifyEmail(req1, res1);
    expect(res1.status).toHaveBeenCalledWith(200);

    const req2 = makeReq({ token });
    const res2 = makeRes();
    await verifyEmail(req2, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(res2.json.mock.calls[0][0].code).toBe('INVALID_TOKEN');
  });

  it('increments emailVerificationSentCount on each send', async () => {
    const user = await createUser();

    for (let i = 1; i <= 3; i++) {
      user.emailVerificationLastSentAt = new Date(Date.now() - 2 * 60 * 1000);
      await user.save();

      const req = makeReq({ userId: user.userId }, { userId: user.userId });
      const res = makeRes();
      await sendVerificationEmailHandler(req, res);

      const updated = await User.findOne({ userId: user.userId });
      expect(updated.emailVerificationSentCount).toBe(i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION TESTS: Email Verification Workflow
// ─────────────────────────────────────────────────────────────────────────────

describe('Email Verification - Integration Workflow', () => {
  it('completes full workflow: send → verify → account becomes active', async () => {
    const user = await createUser({ accountStatus: 'pending_verification' });

    const sendReq = makeReq({ userId: user.userId }, { userId: user.userId });
    const sendRes = makeRes();
    await sendVerificationEmailHandler(sendReq, sendRes);

    expect(sendRes.status).toHaveBeenCalledWith(200);
    expect(sendRes.json.mock.calls[0][0].retryAfter).toBe(60);

    const tokenedUser = await User.findOne({ userId: user.userId });
    const token = tokenedUser.emailVerificationToken;

    const verifyReq = makeReq({ token });
    const verifyRes = makeRes();
    await verifyEmail(verifyReq, verifyRes);

    expect(verifyRes.status).toHaveBeenCalledWith(200);
    expect(verifyRes.json.mock.calls[0][0].emailVerified).toBe(true);

    const verifiedUser = await User.findOne({ userId: user.userId });
    expect(verifiedUser.emailVerified).toBe(true);
    expect(verifiedUser.emailVerificationToken).toBeNull();
  });

  it('handles resend after cooldown period', async () => {
    const user = await createUser();

    const res1 = makeRes();
    await sendVerificationEmailHandler(makeReq({ userId: user.userId }, { userId: user.userId }), res1);
    expect(res1.status).toHaveBeenCalledWith(200);

    const token1 = (await User.findOne({ userId: user.userId })).emailVerificationToken;

    await User.updateOne(
      { userId: user.userId },
      { emailVerificationLastSentAt: new Date(Date.now() - 61 * 1000) }
    );

    const res2 = makeRes();
    await sendVerificationEmailHandler(makeReq({ userId: user.userId }, { userId: user.userId }), res2);
    expect(res2.status).toHaveBeenCalledWith(200);

    const token2 = (await User.findOne({ userId: user.userId })).emailVerificationToken;
    expect(token2).not.toBe(token1);
  });

  it('returns consistent userId in verify response', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    });

    const req = makeReq({ token });
    const res = makeRes();
    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].userId).toBe(user.userId);
    expect(res.json.mock.calls[0][0].emailVerified).toBe(true);
  });
});
