/**
 * Email Service Unit Tests
 *
 * Covers:
 *  - sendVerificationEmail  (flow f13)
 *  - sendPasswordResetEmail (flow f20)
 *  - sendAccountReadyEmail  (flows f23/f24)
 *  - Retry logic: up to 3 attempts with exponential backoff
 *  - Transient errors are retried; permanent errors stop immediately
 *  - Dev-mode returns without sending
 *  - Delivery audit logs written on success and failure
 *  - Rate limiting (max 5 emails/user/24 h) lives in the controller — see emailVerification.test.js
 */

const mongoose = require('mongoose');

const MONGO_URI =
  process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-email';

// ─── Mock nodemailer before requiring emailService ────────────────────────────

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

// ─── Module references (populated in beforeAll after DB connect) ───────────────

let AuditLog;
let sendVerificationEmail;
let sendPasswordResetEmail;
let sendAccountReadyEmail;
let isTransientError;
let sendWithRetry;
let createTransporter;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();

  // Load modules after the connection is established so they share the same instance
  AuditLog = require('../src/models/AuditLog');
  ({ sendVerificationEmail, sendPasswordResetEmail, sendAccountReadyEmail, _internal: {
    isTransientError, sendWithRetry, createTransporter,
  } } = require('../src/services/emailService'));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  mockSendMail.mockReset();
  await AuditLog.deleteMany({});
});

// ─── isTransientError ─────────────────────────────────────────────────────────

describe('isTransientError', () => {
  it('classifies network codes as transient', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']) {
      expect(isTransientError({ code })).toBe(true);
    }
  });

  it('classifies SMTP 4xx (except 452) as transient', () => {
    expect(isTransientError({ responseCode: 421 })).toBe(true);
    expect(isTransientError({ responseCode: 450 })).toBe(true);
  });

  it('classifies 452 (mailbox full) as permanent', () => {
    expect(isTransientError({ responseCode: 452 })).toBe(false);
  });

  it('classifies SMTP 5xx as permanent', () => {
    expect(isTransientError({ responseCode: 550 })).toBe(false);
    expect(isTransientError({ responseCode: 535 })).toBe(false);
  });

  it('classifies generic errors as permanent', () => {
    expect(isTransientError({ message: 'auth failed' })).toBe(false);
  });
});

// ─── sendWithRetry ────────────────────────────────────────────────────────────

describe('sendWithRetry', () => {
  const transporter = { sendMail: mockSendMail };

  it('succeeds on first attempt', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-1' });

    const result = await sendWithRetry(transporter, { to: 'a@b.com', subject: 'x' });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(result.attempts).toBe(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds on second attempt', async () => {
    const transientErr = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
    mockSendMail
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce({ messageId: 'msg-2' });

    const result = await sendWithRetry(transporter, { to: 'a@b.com', subject: 'x' });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  }, 10000);

  it('exhausts all 3 attempts on repeated transient errors', async () => {
    const transientErr = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    mockSendMail.mockRejectedValue(transientErr);

    const result = await sendWithRetry(transporter, { to: 'a@b.com', subject: 'x' });

    expect(result.success).toBe(false);
    expect(result.permanent).toBe(false);
    expect(result.attempts).toBe(3);
    expect(mockSendMail).toHaveBeenCalledTimes(3);
  }, 15000);

  it('stops immediately on permanent error (no retry)', async () => {
    const permanentErr = Object.assign(new Error('invalid recipient'), { responseCode: 550 });
    mockSendMail.mockRejectedValueOnce(permanentErr);

    const result = await sendWithRetry(transporter, { to: 'bad@bad.com', subject: 'x' });

    expect(result.success).toBe(false);
    expect(result.permanent).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});

// ─── Dev-mode behaviour ───────────────────────────────────────────────────────

describe('dev mode (no transporter configured)', () => {
  let savedUser, savedService, savedHost;

  beforeEach(() => {
    savedUser = process.env.EMAIL_USER;
    savedService = process.env.EMAIL_SERVICE;
    savedHost = process.env.EMAIL_HOST;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_SERVICE;
    delete process.env.EMAIL_HOST;
  });

  afterEach(() => {
    if (savedUser !== undefined) process.env.EMAIL_USER = savedUser;
    if (savedService !== undefined) process.env.EMAIL_SERVICE = savedService;
    if (savedHost !== undefined) process.env.EMAIL_HOST = savedHost;
  });

  it('sendVerificationEmail returns sent without calling nodemailer', async () => {
    const result = await sendVerificationEmail('user@example.com', 'tok123');
    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('dev-mode');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sendPasswordResetEmail returns sent without calling nodemailer', async () => {
    const result = await sendPasswordResetEmail('user@example.com', 'resetTok');
    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('dev-mode');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sendAccountReadyEmail returns sent without calling nodemailer', async () => {
    const result = await sendAccountReadyEmail('user@example.com', 'student');
    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('dev-mode');
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ─── sendVerificationEmail ────────────────────────────────────────────────────

describe('sendVerificationEmail', () => {
  const USER_ID = 'usr_test01';

  beforeEach(() => {
    process.env.EMAIL_USER = 'noreply@example.com';
    process.env.EMAIL_SERVICE = 'gmail';
    process.env.EMAIL_PASSWORD = 'secret';
  });

  afterEach(() => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_SERVICE;
    delete process.env.EMAIL_PASSWORD;
  });

  it('returns sent status and writes EMAIL_VERIFICATION_SENT audit log on success', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'verify-msg-1' });

    const result = await sendVerificationEmail('student@example.com', 'abc123', USER_ID);

    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('verify-msg-1');
    expect(result.recipient).toBe('student@example.com');

    const log = await AuditLog.findOne({ actorId: USER_ID, action: 'EMAIL_VERIFICATION_SENT' });
    expect(log).not.toBeNull();
    expect(log.changes.email).toBe('student@example.com');
  });

  it('returns failed status and writes EMAIL_DELIVERY_FAILED log on permanent error', async () => {
    const permanentErr = Object.assign(new Error('bad address'), { responseCode: 550 });
    mockSendMail.mockRejectedValueOnce(permanentErr);

    const result = await sendVerificationEmail('bad@bad.com', 'tok', USER_ID);

    expect(result.status).toBe('failed');
    expect(result.permanent).toBe(true);

    const log = await AuditLog.findOne({ actorId: USER_ID, action: 'EMAIL_DELIVERY_FAILED' });
    expect(log).not.toBeNull();
    expect(log.changes.type).toBe('verification');
    expect(log.changes.permanent).toBe(true);
  });

  it('retries on transient error and returns failed after all attempts', async () => {
    const transientErr = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
    mockSendMail.mockRejectedValue(transientErr);

    const result = await sendVerificationEmail('user@example.com', 'tok', USER_ID);

    expect(result.status).toBe('failed');
    expect(result.permanent).toBe(false);
    expect(result.attempts).toBe(3);

    const log = await AuditLog.findOne({ actorId: USER_ID, action: 'EMAIL_DELIVERY_FAILED' });
    expect(log.changes.permanent).toBe(false);
  }, 15000);

  it('skips audit log when userId is omitted', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'anon-msg' });

    await sendVerificationEmail('anon@example.com', 'tok');

    const count = await AuditLog.countDocuments({ action: 'EMAIL_VERIFICATION_SENT' });
    expect(count).toBe(0);
  });
});

// ─── sendPasswordResetEmail ───────────────────────────────────────────────────

describe('sendPasswordResetEmail', () => {
  const USER_ID = 'usr_test02';

  beforeEach(() => {
    process.env.EMAIL_USER = 'noreply@example.com';
    process.env.EMAIL_SERVICE = 'gmail';
    process.env.EMAIL_PASSWORD = 'secret';
  });

  afterEach(() => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_SERVICE;
    delete process.env.EMAIL_PASSWORD;
  });

  it('returns sent status and writes EMAIL_PASSWORD_RESET_SENT audit log', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'reset-msg-1' });

    const result = await sendPasswordResetEmail('user@example.com', 'resetToken', USER_ID);

    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('reset-msg-1');

    const log = await AuditLog.findOne({ actorId: USER_ID, action: 'EMAIL_PASSWORD_RESET_SENT' });
    expect(log).not.toBeNull();
  });

  it('returns failed and writes EMAIL_DELIVERY_FAILED on permanent error', async () => {
    const err = Object.assign(new Error('invalid'), { responseCode: 550 });
    mockSendMail.mockRejectedValueOnce(err);

    const result = await sendPasswordResetEmail('bad@bad.com', 'tok', USER_ID);

    expect(result.status).toBe('failed');
    const log = await AuditLog.findOne({ actorId: USER_ID, action: 'EMAIL_DELIVERY_FAILED' });
    expect(log.changes.type).toBe('password_reset');
  });
});

// ─── sendAccountReadyEmail ────────────────────────────────────────────────────

describe('sendAccountReadyEmail', () => {
  const USER_ID = 'usr_test03';

  beforeEach(() => {
    process.env.EMAIL_USER = 'noreply@example.com';
    process.env.EMAIL_SERVICE = 'gmail';
    process.env.EMAIL_PASSWORD = 'secret';
  });

  afterEach(() => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_SERVICE;
    delete process.env.EMAIL_PASSWORD;
  });

  it.each(['student', 'professor', 'admin', 'committee_member'])(
    'sends account-ready email for role: %s',
    async (role) => {
      mockSendMail.mockResolvedValueOnce({ messageId: `ready-${role}` });

      const result = await sendAccountReadyEmail('user@example.com', role, USER_ID);

      expect(result.status).toBe('sent');
      expect(result.messageId).toBe(`ready-${role}`);

      const log = await AuditLog.findOne({
        actorId: USER_ID,
        action: 'EMAIL_ACCOUNT_READY_SENT',
        'changes.role': role,
      });
      expect(log).not.toBeNull();

      await AuditLog.deleteMany({});
      mockSendMail.mockReset();
    }
  );

  it('falls back to student template for unknown role', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'fallback-msg' });

    const result = await sendAccountReadyEmail('user@example.com', 'unknown_role', USER_ID);

    expect(result.status).toBe('sent');
    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.subject).toContain('student');
  });

  it('writes EMAIL_DELIVERY_FAILED log on permanent failure', async () => {
    const err = Object.assign(new Error('rejected'), { responseCode: 550 });
    mockSendMail.mockRejectedValueOnce(err);

    const result = await sendAccountReadyEmail('bad@bad.com', 'student', USER_ID);

    expect(result.status).toBe('failed');
    const log = await AuditLog.findOne({ actorId: USER_ID, action: 'EMAIL_DELIVERY_FAILED' });
    expect(log.changes.type).toBe('account_ready');
  });
});
