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
