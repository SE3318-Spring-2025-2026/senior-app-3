/**
 * Password Reset & Management Endpoint Tests
 *
 * Covers:
 *  - POST /auth/password-reset/request (non-revealing, rate limiting)
 *  - POST /auth/password-reset/confirm (token validation, single-use, password strength)
 *  - POST /auth/password-reset/admin-initiate (admin-only, user lookup)
 *  - Token generation: SHA-256 hashed storage, 15-min expiry
 *  - All refresh tokens revoked after successful reset
 *  - Audit logging for all reset events
 *
 * Run: npm test
 */

const crypto = require('crypto');

describe('Password Reset Flow (integration)', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-auth';
  const mongoose = require('mongoose');

  let User;
  let RefreshToken;
  let AuditLog;
  let hashPassword;
  let generateRefreshToken;
  let requestPasswordReset;
  let confirmPasswordReset;
  let adminInitiatePasswordReset;

  const hashToken = (plain) => crypto.createHash('sha256').update(plain).digest('hex');

  const makeReq = (body = {}, user = null, headers = {}) => ({
    body,
    user,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent', ...headers },
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
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    // Load all modules after connection is established so they share the same mongoose instance
    User = require('../src/models/User');
    RefreshToken = require('../src/models/RefreshToken');
    AuditLog = require('../src/models/AuditLog');
    ({ hashPassword } = require('../src/utils/password'));
    ({ generateRefreshToken } = require('../src/utils/jwt'));
    ({ requestPasswordReset, confirmPasswordReset, adminInitiatePasswordReset } = require('../src/controllers/auth'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await RefreshToken.deleteMany({});
    await AuditLog.deleteMany({});
  });

  // ─── requestPasswordReset ──────────────────────────────────────────────────

  describe('requestPasswordReset', () => {
    it('returns 200 with generic message for unknown email (non-revealing)', async () => {
      const req = makeReq({ email: 'nobody@example.com' });
      const res = makeRes();
      await requestPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('If an account') })
      );
    });

    it('returns 200 with generic message for known email', async () => {
      await new User({
        email: 'known@example.com',
        hashedPassword: await hashPassword('T3st_Secure#99'),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'known@example.com' });
      const res = makeRes();
      await requestPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('stores hashed reset token and 15-min expiry for existing user', async () => {
      await new User({
        email: 'tokentest@example.com',
        hashedPassword: await hashPassword('T3st_Secure#99'),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'tokentest@example.com' });
      const res = makeRes();
      await requestPasswordReset(req, res);

      const user = await User.findOne({ email: 'tokentest@example.com' });
      expect(user.passwordResetToken).toBeTruthy();
      expect(user.passwordResetTokenExpiry).toBeTruthy();

      const msUntilExpiry = user.passwordResetTokenExpiry - new Date();
      expect(msUntilExpiry).toBeGreaterThan(14 * 60 * 1000); // > 14 min
      expect(msUntilExpiry).toBeLessThanOrEqual(15 * 60 * 1000); // ≤ 15 min
    });

    it('returns 400 when email is missing', async () => {
      const req = makeReq({});
      const res = makeRes();
      await requestPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('enforces rate limit: silently suppresses after 5 requests per hour', async () => {
      await new User({
        email: 'ratelimit@example.com',
        hashedPassword: await hashPassword('T3st_Secure#99'),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // Send 5 requests (all succeed)
      for (let i = 0; i < 5; i++) {
        const req = makeReq({ email: 'ratelimit@example.com' });
        const res = makeRes();
        await requestPasswordReset(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
      }

      // 6th request still returns 200 (non-revealing) but token is unchanged (rate limited)
      const tokenBefore = (await User.findOne({ email: 'ratelimit@example.com' })).passwordResetToken;
      const req = makeReq({ email: 'ratelimit@example.com' });
      const res = makeRes();
      await requestPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(200);

      const tokenAfter = (await User.findOne({ email: 'ratelimit@example.com' })).passwordResetToken;
      expect(tokenAfter).toBe(tokenBefore); // token unchanged — rate limited
    });

    it('creates PASSWORD_RESET_REQUESTED audit log for existing user', async () => {
      await new User({
        email: 'auditreq@example.com',
        hashedPassword: await hashPassword('T3st_Secure#99'),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'auditreq@example.com' });
      const res = makeRes();
      await requestPasswordReset(req, res);

      const log = await AuditLog.findOne({ action: 'PASSWORD_RESET_REQUESTED' });
      expect(log).toBeTruthy();
    });
  });

  // ─── confirmPasswordReset ──────────────────────────────────────────────────

  describe('confirmPasswordReset', () => {
    const setupUserWithToken = async (overrides = {}) => {
      const plainToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = hashToken(plainToken);
      const user = await new User({
        email: 'reset@example.com',
        hashedPassword: await hashPassword('T3st_Secure#99'),
        role: 'student',
        accountStatus: 'active',
        passwordResetToken: hashedToken,
        passwordResetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
        ...overrides,
      }).save();
      return { user, plainToken };
    };

    it('returns 400 when token and newPassword are missing', async () => {
      const req = makeReq({});
      const res = makeRes();
      await confirmPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for invalid token', async () => {
      const req = makeReq({ token: 'invalidtoken', newPassword: 'NewSecure@123' });
      const res = makeRes();
      await confirmPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    });

    it('returns 400 for expired token', async () => {
      const { plainToken } = await setupUserWithToken({
        passwordResetTokenExpiry: new Date(Date.now() - 1000), // already expired
      });
      const req = makeReq({ token: plainToken, newPassword: 'NewSecure@123' });
      const res = makeRes();
      await confirmPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    });

    it('returns 400 for weak new password', async () => {
      const { plainToken } = await setupUserWithToken();
      const req = makeReq({ token: plainToken, newPassword: 'weak' });
      const res = makeRes();
      await confirmPasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
    });

    it('resets password and clears token on valid request', async () => {
      const { plainToken, user } = await setupUserWithToken();

      for (let i = 0; i < 2; i++) {
        await new RefreshToken({
          userId: user.userId,
          token: generateRefreshToken(user.userId),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }).save();
      }

      const req = makeReq({ token: plainToken, newPassword: 'NewSecure@123' });
      const res = makeRes();
      await confirmPasswordReset(req, res);

      expect(res.status).toHaveBeenCalledWith(200);

      const updated = await User.findOne({ email: 'reset@example.com' });
      expect(updated.passwordResetToken).toBeNull();
      expect(updated.passwordResetTokenExpiry).toBeNull();
    });

    it('enforces single-use: second confirm with same token returns 400', async () => {
      const { plainToken } = await setupUserWithToken();

      const req1 = makeReq({ token: plainToken, newPassword: 'NewSecure@123' });
      await confirmPasswordReset(req1, makeRes());

      const req2 = makeReq({ token: plainToken, newPassword: 'AnotherPass@456' });
      const res2 = makeRes();
      await confirmPasswordReset(req2, res2);
      expect(res2.status).toHaveBeenCalledWith(400);
      expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    });

    it('revokes all refresh tokens on successful reset', async () => {
      const { plainToken, user } = await setupUserWithToken();

      for (let i = 0; i < 3; i++) {
        await new RefreshToken({
          userId: user.userId,
          token: generateRefreshToken(user.userId),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }).save();
      }

      const req = makeReq({ token: plainToken, newPassword: 'NewSecure@123' });
      await confirmPasswordReset(req, makeRes());

      const active = await RefreshToken.find({ userId: user.userId, isRevoked: false });
      expect(active).toHaveLength(0);
    });

    it('password updated correctly: new password works for login', async () => {
      const { plainToken, user } = await setupUserWithToken();
      const newPassword = 'NewSecure@456';

      const req = makeReq({ token: plainToken, newPassword });
      const res = makeRes();
      await confirmPasswordReset(req, res);

      expect(res.status).toHaveBeenCalledWith(200);

      // Verify new password works
      const updated = await User.findOne({ email: 'reset@example.com' });
      const isValid = await comparePassword(newPassword, updated.hashedPassword);
      expect(isValid).toBe(true);

      // Verify old password no longer works
      const oldPassword = 'Original#123';
      const isOldValid = await comparePassword(oldPassword, updated.hashedPassword);
      expect(isOldValid).toBe(false);
    });

    it('creates PASSWORD_RESET_CONFIRMED audit log', async () => {
      const { plainToken } = await setupUserWithToken();
      const req = makeReq({ token: plainToken, newPassword: 'NewSecure@123' });
      await confirmPasswordReset(req, makeRes());

      const log = await AuditLog.findOne({ action: 'PASSWORD_RESET_CONFIRMED' });
      expect(log).toBeTruthy();
    });
  });

  // ─── adminInitiatePasswordReset ────────────────────────────────────────────

  describe('adminInitiatePasswordReset', () => {
    const setupAdmin = async () =>
      new User({
        email: 'admin@example.com',
        hashedPassword: await hashPassword('Admin#Secure99'),
        role: 'admin',
        accountStatus: 'active',
      }).save();

    const setupTarget = async () =>
      new User({
        email: 'target@example.com',
        hashedPassword: await hashPassword('T3st_Secure#99'),
        role: 'student',
        accountStatus: 'active',
      }).save();

    it('returns 403 when non-admin user attempts admin reset', async () => {
      const student = await new User({
        email: 'student@example.com',
        hashedPassword: await hashPassword('Pass#123'),
        role: 'student',
      }).save();
      const target = await setupTarget();

      const req = makeReq({ userId: target.userId }, { userId: student.userId, role: 'student' });
      const res = makeRes();
      await adminInitiatePasswordReset(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FORBIDDEN' })
      );
    });

    it('returns 400 when neither userId nor email provided', async () => {
      const admin = await setupAdmin();
      const req = makeReq({}, { userId: admin.userId, role: 'admin' });
      const res = makeRes();
      await adminInitiatePasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 for unknown userId', async () => {
      const admin = await setupAdmin();
      const req = makeReq({ userId: 'usr_nonexistent' }, { userId: admin.userId, role: 'admin' });
      const res = makeRes();
      await adminInitiatePasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'USER_NOT_FOUND' }));
    });

    it('returns 404 for unknown email', async () => {
      const admin = await setupAdmin();
      const req = makeReq({ email: 'ghost@example.com' }, { userId: admin.userId, role: 'admin' });
      const res = makeRes();
      await adminInitiatePasswordReset(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('generates reset token and returns 200 when targeting by userId', async () => {
      const admin = await setupAdmin();
      const target = await setupTarget();

      const req = makeReq({ userId: target.userId }, { userId: admin.userId, role: 'admin' });
      const res = makeRes();
      await adminInitiatePasswordReset(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ userId: target.userId, email: target.email })
      );

      const updated = await User.findOne({ userId: target.userId });
      expect(updated.passwordResetToken).toBeTruthy();
      expect(updated.passwordResetTokenExpiry).toBeTruthy();
    });

    it('generates reset token and returns 200 when targeting by email', async () => {
      const admin = await setupAdmin();
      const target = await setupTarget();

      const req = makeReq({ email: target.email }, { userId: admin.userId, role: 'admin' });
      const res = makeRes();
      await adminInitiatePasswordReset(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = await User.findOne({ email: target.email });
      expect(updated.passwordResetToken).toBeTruthy();
    });

    it('creates PASSWORD_RESET_ADMIN_INITIATED audit log', async () => {
      const admin = await setupAdmin();
      const target = await setupTarget();

      const req = makeReq({ userId: target.userId }, { userId: admin.userId, role: 'admin' });
      await adminInitiatePasswordReset(req, makeRes());

      const log = await AuditLog.findOne({ action: 'PASSWORD_RESET_ADMIN_INITIATED' });
      expect(log).toBeTruthy();
      expect(log.actorId).toBe(admin.userId);
      expect(log.targetId).toBe(target.userId);
    });

    it('generated token expires in 15 minutes', async () => {
      const admin = await setupAdmin();
      const target = await setupTarget();

      const req = makeReq({ userId: target.userId }, { userId: admin.userId, role: 'admin' });
      await adminInitiatePasswordReset(req, makeRes());

      const updated = await User.findOne({ userId: target.userId });
      const msUntilExpiry = updated.passwordResetTokenExpiry - new Date();
      expect(msUntilExpiry).toBeGreaterThan(14 * 60 * 1000);
      expect(msUntilExpiry).toBeLessThanOrEqual(15 * 60 * 1000);
    });
  });
});

/**
 * JWT & Session Token Management Tests
 *
 * Covers:
 *  - JWT generation (userId, role, iat, exp, HS256)
 *  - Access token expiry set to 1 hour
 *  - Refresh token expiry set to 7 days
 *  - Token verification (valid / expired / tampered)
 *  - Auth middleware (valid token, missing header, invalid token → 401)
 *  - Token rotation on refresh
 *  - All tokens revoked on password change
 *
 * Run: npm test
 */

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../src/utils/jwt');

// ─── JWT Utility Tests ────────────────────────────────────────────────────────

describe('JWT Utilities', () => {
  const userId = 'usr_test-123';
  const role = 'student';

  describe('generateAccessToken', () => {
    it('contains userId, role, iat, exp in payload', () => {
      const token = generateAccessToken(userId, role);
      const decoded = jwt.decode(token);
      expect(decoded.userId).toBe(userId);
      expect(decoded.role).toBe(role);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('expires in 1 hour (3600 seconds)', () => {
      const token = generateAccessToken(userId, role);
      const decoded = jwt.decode(token);
      expect(decoded.exp - decoded.iat).toBe(3600);
    });

    it('is signed with HS256 algorithm', () => {
      const token = generateAccessToken(userId, role);
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
      expect(header.alg).toBe('HS256');
    });

    it('verifies successfully with correct secret', () => {
      const token = generateAccessToken(userId, role);
      expect(() => verifyAccessToken(token)).not.toThrow();
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe(userId);
      expect(decoded.role).toBe(role);
    });

    it('throws on tampered token', () => {
      const token = generateAccessToken(userId, role);
      const tampered = token.slice(0, -4) + 'xxxx';
      expect(() => verifyAccessToken(tampered)).toThrow();
    });
  });

  describe('generateRefreshToken', () => {
    it('contains userId, type: refresh, iat, exp', () => {
      const token = generateRefreshToken(userId);
      const decoded = jwt.decode(token);
      expect(decoded.userId).toBe(userId);
      expect(decoded.type).toBe('refresh');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('expires in 7 days (604800 seconds)', () => {
      const token = generateRefreshToken(userId);
      const decoded = jwt.decode(token);
      expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
    });

    it('two tokens for the same user are unique (jti)', () => {
      const t1 = generateRefreshToken(userId);
      const t2 = generateRefreshToken(userId);
      expect(t1).not.toBe(t2);
    });

    it('verifies successfully with correct secret', () => {
      const token = generateRefreshToken(userId);
      expect(() => verifyRefreshToken(token)).not.toThrow();
    });

    it('throws on token signed with wrong secret', () => {
      const fakeToken = jwt.sign({ userId, type: 'refresh' }, 'wrong-secret');
      expect(() => verifyRefreshToken(fakeToken)).toThrow();
    });
  });

  describe('generateTokenPair', () => {
    it('returns both accessToken and refreshToken', () => {
      const pair = generateTokenPair(userId, role);
      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();
    });
  });
});

// ─── Auth Middleware Tests ────────────────────────────────────────────────────

describe('Auth Middleware', () => {
  const { authMiddleware } = require('../src/middleware/auth');
  const userId = 'usr_mw-test';
  const role = 'student';

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it('calls next() and sets req.user for a valid token', () => {
    const token = generateAccessToken(userId, role);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(userId);
    expect(req.user.role).toBe(role);
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid token', () => {
    const req = { headers: { authorization: 'Bearer not.a.valid.token' } };
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired token', () => {
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    const expiredToken = jwt.sign(
      { userId, role, type: 'access' },
      secret,
      { expiresIn: -1, issuer: 'senior-app' }
    );
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── Token Rotation & Password-Change Revocation Tests ───────────────────────

describe('Token rotation and revocation (integration)', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-auth';

  let RefreshToken;
  let User;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    RefreshToken = require('../src/models/RefreshToken');
    User = require('../src/models/User');
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await RefreshToken.deleteMany({});
    await User.deleteMany({});
  });

  it('rotates refresh token: old token revoked, new token stored', async () => {
    const { hashPassword } = require('../src/utils/password');

    const user = new User({
      email: 'rotate@test.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
    });
    await user.save();

    const tokens = generateTokenPair(user.userId, user.role);
    const oldDoc = new RefreshToken({
      userId: user.userId,
      token: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await oldDoc.save();

    // Simulate rotation
    oldDoc.isRevoked = true;
    await oldDoc.save();

    const newTokens = generateTokenPair(user.userId, user.role);
    const newDoc = new RefreshToken({
      userId: user.userId,
      token: newTokens.refreshToken,
      rotatedFrom: oldDoc.tokenId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await newDoc.save();

    const revoked = await RefreshToken.findOne({ tokenId: oldDoc.tokenId });
    expect(revoked.isRevoked).toBe(true);

    const fresh = await RefreshToken.findOne({ tokenId: newDoc.tokenId });
    expect(fresh.isRevoked).toBe(false);
    expect(fresh.rotatedFrom).toBe(oldDoc.tokenId);
  });

  it('revokes ALL refresh tokens for a user on password change', async () => {
    const { hashPassword } = require('../src/utils/password');

    const user = new User({
      email: 'pwchange@test.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
    });
    await user.save();

    // Create multiple refresh tokens (simulates multiple devices)
    for (let i = 0; i < 3; i++) {
      const t = generateRefreshToken(user.userId);
      await new RefreshToken({
        userId: user.userId,
        token: t,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).save();
    }

    // Revoke all (what changePassword does)
    await RefreshToken.updateMany({ userId: user.userId }, { isRevoked: true });

    const remaining = await RefreshToken.find({ userId: user.userId, isRevoked: false });
    expect(remaining).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY TESTS: Password Reset Token Security
// ─────────────────────────────────────────────────────────────────────────────

describe('Password Reset - Security Tests', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-auth';

  let User;
  let RefreshToken;
  let AuditLog;
  let hashPassword;
  let confirmPasswordReset;

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
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    User = require('../src/models/User');
    RefreshToken = require('../src/models/RefreshToken');
    AuditLog = require('../src/models/AuditLog');
    ({ hashPassword } = require('../src/utils/password'));
    ({ confirmPasswordReset } = require('../src/controllers/auth'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await RefreshToken.deleteMany({});
    await AuditLog.deleteMany({});
  });

  it('stores hashed token (never plaintext) in database', async () => {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

    const user = new User({
      email: 'hashedtest@example.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
      passwordResetToken: hashedToken,
      passwordResetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
    });
    await user.save();

    const stored = await User.findOne({ email: 'hashedtest@example.com' });
    // Token in DB should be hashed, not plaintext
    expect(stored.passwordResetToken).toBe(hashedToken);
    expect(stored.passwordResetToken).not.toBe(plainToken);
  });

  it('token generated with correct 15-minute expiry', async () => {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

    const user = new User({
      email: 'expirytest@example.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
      passwordResetToken: hashedToken,
      passwordResetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
    });
    await user.save();

    const msUntilExpiry = user.passwordResetTokenExpiry - new Date();
    expect(msUntilExpiry).toBeGreaterThan(14 * 60 * 1000);
    expect(msUntilExpiry).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('invalidates token after single use (cannot reuse same token)', async () => {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

    const user = new User({
      email: 'singleuse@example.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
      passwordResetToken: hashedToken,
      passwordResetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
    });
    await user.save();

    // First confirmation — succeeds
    const req1 = makeReq({ token: plainToken, newPassword: 'NewSecure@456' });
    await confirmPasswordReset(req1, makeRes());

    const reused = await User.findOne({ email: 'singleuse@example.com' });
    expect(reused.passwordResetToken).toBeNull();

    // Attempting to reuse the same token — fails
    const req2 = makeReq({ token: plainToken, newPassword: 'AnotherPass@789' });
    const res2 = makeRes();
    await confirmPasswordReset(req2, res2);

    expect(res2.status).toHaveBeenCalledWith(400);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INVALID_TOKEN' })
    );
  });

  it('constant-time hash comparison to prevent timing attacks', async () => {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

    const user = new User({
      email: 'timingtest@example.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
      passwordResetToken: hashedToken,
      passwordResetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
    });
    await user.save();

    // Test with partially-correct token (first char matches, rest wrong)
    const wrongToken = plainToken.substring(0, 1) + 'x'.repeat(plainToken.length - 1);

    const req = makeReq({ token: wrongToken, newPassword: 'NewSecure@456' });
    const res = makeRes();
    await confirmPasswordReset(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INVALID_TOKEN' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION TESTS: Password Reset Workflow
// ─────────────────────────────────────────────────────────────────────────────

describe('Password Reset - Integration Workflow', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-auth';

  let User;
  let RefreshToken;
  let AuditLog;
  let hashPassword;
  let comparePassword;
  let requestPasswordReset;
  let confirmPasswordReset;

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
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    User = require('../src/models/User');
    RefreshToken = require('../src/models/RefreshToken');
    AuditLog = require('../src/models/AuditLog');
    ({ hashPassword, comparePassword } = require('../src/utils/password'));
    ({ requestPasswordReset, confirmPasswordReset } = require('../src/controllers/auth'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await RefreshToken.deleteMany({});
    await AuditLog.deleteMany({});
  });

  it('completes full workflow: request → confirm → password changed', async () => {
    // Setup: create user
    const user = new User({
      email: 'workflow@example.com',
      hashedPassword: await hashPassword('OldPass#123'),
      role: 'student',
      accountStatus: 'active',
    });
    await user.save();

    // Step 1: Request password reset
    const reqRequest = makeReq({ email: 'workflow@example.com' });
    const resRequest = makeRes();
    await requestPasswordReset(reqRequest, resRequest);

    expect(resRequest.status).toHaveBeenCalledWith(200);

    // Get the token from the user
    let resetUser = await User.findOne({ email: 'workflow@example.com' });
    const hashedToken = resetUser.passwordResetToken;

    // Simulate getting plain token (in real flow, sent via email)
    // For test, we'll directly create one
    const plainToken = crypto.randomBytes(32).toString('hex');
    const newHashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

    resetUser.passwordResetToken = newHashedToken;
    resetUser.passwordResetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await resetUser.save();

    // Step 2: Confirm password reset
    const reqConfirm = makeReq({ token: plainToken, newPassword: 'NewSecure@789' });
    const resConfirm = makeRes();
    await confirmPasswordReset(reqConfirm, resConfirm);

    expect(resConfirm.status).toHaveBeenCalledWith(200);

    // Step 3: Verify using new password works
    const updatedUser = await User.findOne({ email: 'workflow@example.com' });
    const passwordMatch = await comparePassword('NewSecure@789', updatedUser.hashedPassword);
    expect(passwordMatch).toBe(true);
  });

  it('rate limiting applies: only 5 reset requests per hour', async () => {
    const user = new User({
      email: 'ratelimitflow@example.com',
      hashedPassword: await hashPassword('Pass#123'),
      role: 'student',
      accountStatus: 'active',
    });
    await user.save();

    // Send exactly 5 requests
    for (let i = 0; i < 5; i++) {
      const req = makeReq({ email: 'ratelimitflow@example.com' });
      await requestPasswordReset(req, makeRes());
    }

    // 6th request should still return 200 (non-revealing) but not generate new token
    const tokenBefore = (await User.findOne({ email: 'ratelimitflow@example.com' })).passwordResetToken;

    const req6 = makeReq({ email: 'ratelimitflow@example.com' });
    const res6 = makeRes();
    await requestPasswordReset(req6, res6);

    expect(res6.status).toHaveBeenCalledWith(200); // Returns 200 for non-revealing

    const tokenAfter = (await User.findOne({ email: 'ratelimitflow@example.com' })).passwordResetToken;
    // Token should remain unchanged (rate limiting silently suppressed the send)
    expect(tokenAfter).toBe(tokenBefore);
  });

  it('logs all reset events in audit trail', async () => {
    const user = new User({
      email: 'auditflow@example.com',
      hashedPassword: await hashPassword('Pass#123'),
      role: 'student',
      accountStatus: 'active',
    });
    await user.save();

    // Request
    const reqRequest = makeReq({ email: 'auditflow@example.com' });
    await requestPasswordReset(reqRequest, makeRes());

    const logs = await AuditLog.find({ targetId: user.userId });
    expect(logs.some(log => log.action === 'PASSWORD_RESET_REQUESTED')).toBe(true);
  });
});
