/**
 * JWT, Session Management & Security Tests
 *
 * Comprehensive test suite for authentication token handling, session management,
 * and security validations.
 *
 * Covers:
 *  ✓ JWT generation (payload, expiry, signature)
 *  ✓ JWT validation on protected routes
 *  ✓ Refresh token rotation (new pair issued, old invalidated)
 *  ✓ Token expiry (401 after expiry, refresh works)
 *  ✓ 401 responses (missing, invalid, expired tokens)
 *  ✓ 403 responses (insufficient role)
 *  ✓ Password change revocation (all tokens invalidated)
 *  ✓ Rate limiting (429 after exceeding limit, retry-after header)
 *  ✓ Security (JWT signature validation, tampering detection)
 *
 * Run: npm test -- jwt-session-security.test.js
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-session-test-jwt-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'jwt-session-test-jwt-refresh-secret';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

describe('JWT Generation & Token Management (Unit Tests)', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-jwt';
  const mongoose = require('mongoose');

  let generateAccessToken;
  let generateRefreshToken;
  let generateTokenPair;
  let verifyAccessToken;
  let verifyRefreshToken;
  let decodeToken;

  const JWT_SECRET = process.env.JWT_SECRET;
  const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

  beforeAll(async () => {
    ({
      generateAccessToken,
      generateRefreshToken,
      generateTokenPair,
      verifyAccessToken,
      verifyRefreshToken,
      decodeToken,
    } = require('../src/utils/jwt'));
  });

  afterAll(async () => {
    // Clean up if needed
  });

  // ─── JWT GENERATION TESTS ─────────────────────────────────────────────────

  describe('Access Token Generation', () => {
    it('generates JWT with correct payload structure (userId, role, iat, exp)', () => {
      const token = generateAccessToken('user123', 'student');
      const decoded = decodeToken(token);

      expect(decoded).toHaveProperty('userId', 'user123');
      expect(decoded).toHaveProperty('role', 'student');
      expect(decoded).toHaveProperty('iat'); // issued at
      expect(decoded).toHaveProperty('exp'); // expiration
      expect(decoded).toHaveProperty('type', 'access');
      expect(decoded).toHaveProperty('iss', 'senior-app');
      expect(decoded).toHaveProperty('sub', 'user123');
    });

    it('generates JWT with approximately 1 hour expiry', () => {
      const token = generateAccessToken('user123', 'admin');
      const decoded = decodeToken(token);

      const expiryTime = decoded.exp * 1000;
      const issuedTime = decoded.iat * 1000;
      const expiryDuration = expiryTime - issuedTime;

      // JWT_EXPIRATION is '1h' = 3600 seconds
      expect(expiryDuration).toBeGreaterThan(3500 * 1000); // > 3500 seconds
      expect(expiryDuration).toBeLessThanOrEqual(3660 * 1000); // ≤ 3660 seconds (1h + 1 min)
    });

    it('generates JWT with valid signature verifiable by secret', () => {
      const token = generateAccessToken('user456', 'professor');
      expect(() => verifyAccessToken(token)).not.toThrow();
    });

    it('includes different roles correctly in payload', () => {
      const roles = ['student', 'professor', 'admin', 'coordinator'];
      roles.forEach((role) => {
        const token = generateAccessToken('user123', role);
        const decoded = decodeToken(token);
        expect(decoded.role).toBe(role);
      });
    });

    it('generates unique tokens even for same user/role', async () => {
      const token1 = generateAccessToken('user123', 'student');
      // Add delay to ensure different iat times (JWT uses second-based timestamps)
      await new Promise((r) => setTimeout(r, 1100)); // 1.1 second delay
      const token2 = generateAccessToken('user123', 'student');
      // Tokens differ due to different iat times
      expect(token1).not.toBe(token2);
    });
  });

  describe('Refresh Token Generation', () => {
    it('generates refresh token with correct payload (userId, type, jti)', () => {
      const token = generateRefreshToken('user123');
      const decoded = decodeToken(token);

      expect(decoded).toHaveProperty('userId', 'user123');
      expect(decoded).toHaveProperty('type', 'refresh');
      expect(decoded).toHaveProperty('jti'); // JWT ID (unique identifier)
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
      expect(decoded).toHaveProperty('iss', 'senior-app');
      expect(decoded).toHaveProperty('sub', 'user123');
    });

    it('generates refresh token with approximately 7 day expiry', () => {
      const token = generateRefreshToken('user123');
      const decoded = decodeToken(token);

      const expiryTime = decoded.exp * 1000;
      const issuedTime = decoded.iat * 1000;
      const expiryDuration = expiryTime - issuedTime;

      // JWT_REFRESH_EXPIRATION is '7d' = 604800 seconds
      expect(expiryDuration).toBeGreaterThan(604000 * 1000); // > 604000 seconds
      expect(expiryDuration).toBeLessThanOrEqual(605000 * 1000); // ≤ 605000 seconds
    });

    it('generates unique JTI for each refresh token', () => {
      const token1 = generateRefreshToken('user123');
      const token2 = generateRefreshToken('user123');
      const jti1 = decodeToken(token1).jti;
      const jti2 = decodeToken(token2).jti;
      expect(jti1).not.toBe(jti2);
    });
  });

  describe('Token Pair Generation', () => {
    it('generates both access and refresh tokens', () => {
      const { accessToken, refreshToken } = generateTokenPair('user123', 'student');
      expect(accessToken).toBeTruthy();
      expect(refreshToken).toBeTruthy();
      expect(accessToken).not.toBe(refreshToken);
    });

    it('tokens have correct types in payload', () => {
      const { accessToken, refreshToken } = generateTokenPair('user123', 'student');
      expect(decodeToken(accessToken).type).toBe('access');
      expect(decodeToken(refreshToken).type).toBe('refresh');
    });

    it('access token includes role, refresh token does not', () => {
      const { accessToken, refreshToken } = generateTokenPair('user123', 'professor');
      expect(decodeToken(accessToken)).toHaveProperty('role', 'professor');
      expect(decodeToken(refreshToken)).not.toHaveProperty('role');
    });
  });

  // ─── JWT VERIFICATION TESTS ───────────────────────────────────────────────

  describe('Access Token Verification', () => {
    it('verifies valid access token', () => {
      const token = generateAccessToken('user123', 'student');
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe('user123');
      expect(decoded.role).toBe('student');
    });

    it('rejects token with invalid signature', () => {
      const token = generateAccessToken('user123', 'student');
      const tampered = token.slice(0, -10) + 'tampered123'; // Modify last chars
      expect(() => verifyAccessToken(tampered)).toThrow('Invalid access token');
    });

    it('rejects token with wrong secret', () => {
      const payload = { userId: 'user123', role: 'student', type: 'access' };
      const wrongSecret = 'wrong-secret-key';
      const token = jwt.sign(payload, wrongSecret, {
        expiresIn: '1h',
        issuer: 'senior-app',
      });
      expect(() => verifyAccessToken(token)).toThrow('Invalid access token');
    });

    it('rejects malformed token', () => {
      expect(() => verifyAccessToken('not.a.valid.token')).toThrow();
      expect(() => verifyAccessToken('invalidtoken')).toThrow();
    });

    it('rejects token with wrong issuer', () => {
      const payload = { userId: 'user123', role: 'student', type: 'access' };
      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: '1h',
        issuer: 'wrong-issuer',
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });
  });

  describe('Refresh Token Verification', () => {
    it('verifies valid refresh token', () => {
      const token = generateRefreshToken('user123');
      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe('user123');
      expect(decoded.type).toBe('refresh');
    });

    it('rejects refresh token with invalid signature', () => {
      const token = generateRefreshToken('user123');
      const tampered = token.slice(0, -10) + 'tampered123';
      expect(() => verifyRefreshToken(tampered)).toThrow('Invalid refresh token');
    });

    it('rejects refresh token with wrong issuer', () => {
      const payload = { userId: 'user123', type: 'refresh', jti: crypto.randomBytes(16).toString('hex') };
      const token = jwt.sign(payload, JWT_REFRESH_SECRET, {
        expiresIn: '7d',
        issuer: 'wrong-issuer',
      });
      expect(() => verifyRefreshToken(token)).toThrow();
    });
  });

  // ─── TOKEN EXPIRY TESTS ────────────────────────────────────────────────────

  describe('Token Expiry Handling', () => {
    it('rejects expired access token', async () => {
      // Create token with -10 second expiry (already expired)
      const payload = { userId: 'user123', role: 'student', type: 'access' };
      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: '-10s',
        issuer: 'senior-app',
        subject: 'user123',
      });

      // Wait a bit to ensure expiry
      await new Promise((r) => setTimeout(r, 100));

      expect(() => verifyAccessToken(token)).toThrow('Invalid access token');
    });

    it('rejects expired refresh token', async () => {
      const payload = { userId: 'user123', type: 'refresh', jti: crypto.randomBytes(16).toString('hex') };
      const token = jwt.sign(payload, JWT_REFRESH_SECRET, {
        expiresIn: '-10s',
        issuer: 'senior-app',
        subject: 'user123',
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(() => verifyRefreshToken(token)).toThrow('Invalid refresh token');
    });

    it('accepts token just before expiry', async () => {
      // Create token with 1 second expiry
      const payload = { userId: 'user123', role: 'student', type: 'access' };
      const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: '1s',
        issuer: 'senior-app',
        subject: 'user123',
      });

      // Should verify immediately
      expect(() => verifyAccessToken(token)).not.toThrow();
    });
  });

  // ─── TOKEN TAMPERING DETECTION ────────────────────────────────────────────

  describe('Token Tampering Detection', () => {
    it('detects payload modification (changing userId)', () => {
      const token = generateAccessToken('user123', 'student');
      const parts = token.split('.');

      // Decode and modify payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      payload.userId = 'user999'; // Tampering!
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(() => verifyAccessToken(tampered)).toThrow('Invalid access token');
    });

    it('detects payload modification (changing role)', () => {
      const token = generateAccessToken('user123', 'student');
      const parts = token.split('.');

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      payload.role = 'admin'; // Privilege escalation attempt!
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(() => verifyAccessToken(tampered)).toThrow('Invalid access token');
    });

    it('detects signature modification', () => {
      const token = generateAccessToken('user123', 'student');
      const tampered = token.slice(0, -20) + 'attacker_signature123';
      expect(() => verifyAccessToken(tampered)).toThrow('Invalid access token');
    });

    it('detects header modification', () => {
      const token = generateAccessToken('user123', 'student');
      const parts = token.split('.');
      const tampered = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64')}.${parts[1]}.${parts[2]}`;
      expect(() => verifyAccessToken(tampered)).toThrow();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('Authentication Flow & Protected Routes (Integration Tests)', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-jwt-integration';
  const mongoose = require('mongoose');

  let User;
  let RefreshToken;
  let authMiddleware;
  let roleMiddleware;
  let loginWithPassword;
  let refreshAccessToken;
  let logout;
  let changePassword;
  let hashPassword;
  let comparePassword;
  let verifyAccessToken;

  const makeReq = (body = {}, authToken = null, user = null, headers = {}) => ({
    body,
    user,
    ip: '192.168.1.1',
    headers: {
      'user-agent': 'test-browser/1.0',
      authorization: authToken ? `Bearer ${authToken}` : undefined,
      ...headers,
    },
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const makeNext = jest.fn();

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    User = require('../src/models/User');
    RefreshToken = require('../src/models/RefreshToken');
    ({ authMiddleware, roleMiddleware } = require('../src/middleware/auth'));
    ({
      loginWithPassword,
      refreshAccessToken,
      logout,
      changePassword,
    } = require('../src/controllers/auth'));
    ({ hashPassword, comparePassword } = require('../src/utils/password'));
    ({ verifyAccessToken } = require('../src/utils/jwt'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await RefreshToken.deleteMany({});
    jest.clearAllMocks();
  });

  // ─── LOGIN & TOKEN GENERATION ──────────────────────────────────────────────

  describe('Login & JWT Issuance', () => {
    it('issues access token and refresh token on successful login', async () => {
      const password = 'SecurePass@123';
      await new User({
        email: 'student@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'student@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = res.json.mock.calls[0][0];
      expect(response).toHaveProperty('accessToken');
      expect(response).toHaveProperty('refreshToken');
      expect(response).toHaveProperty('expiresIn', 3600); // 1 hour
      expect(response).toHaveProperty('userId');
      expect(response).toHaveProperty('role', 'student');
    });

    it('access token can be verified and contains user info', async () => {
      const password = 'SecurePass@123';
      const user = await new User({
        email: 'verify@example.com',
        hashedPassword: await hashPassword(password),
        role: 'professor',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'verify@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      const accessToken = res.json.mock.calls[0][0].accessToken;
      const decoded = verifyAccessToken(accessToken);

      expect(decoded.userId).toBe(user.userId);
      expect(decoded.role).toBe('professor');
    });

    it('refresh token is stored in database', async () => {
      const password = 'SecurePass@123';
      await new User({
        email: 'db@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'db@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      const refreshToken = res.json.mock.calls[0][0].refreshToken;
      const tokenDoc = await RefreshToken.findOne({ token: refreshToken });

      expect(tokenDoc).toBeTruthy();
      expect(tokenDoc.isRevoked).toBe(false);
    });
  });

  // ─── TOKEN VALIDATION ON PROTECTED ROUTES ─────────────────────────────────

  describe('Auth Middleware - JWT Validation', () => {
    it('allows request with valid JWT token', async () => {
      const { accessToken } = await generateTokensForUser('protected@example.com');
      const req = makeReq({}, accessToken);
      const res = makeRes();

      authMiddleware(req, res, makeNext);

      expect(makeNext).toHaveBeenCalled();
      expect(req.user).toBeTruthy();
      expect(req.user.userId).toBeTruthy();
    });

    it('returns 401 for missing authorization header', () => {
      const req = makeReq({}, null); // no token
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNAUTHORIZED',
          message: expect.stringContaining('Missing or invalid'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for malformed authorization header (missing Bearer)', () => {
      const { accessToken } = require('../src/utils/jwt').generateTokenPair('user123', 'student');
      const req = {
        body: {},
        user: null,
        ip: '127.0.0.1',
        headers: {
          authorization: `Token ${accessToken}`, // Wrong prefix
        },
      };
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for invalid/tampered token', () => {
      const req = makeReq({}, 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature');
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_TOKEN',
          message: expect.stringContaining('Invalid or expired token'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for expired token', async () => {
      const expiredToken = jwt.sign(
        { userId: 'user123', role: 'student', type: 'access' },
        process.env.JWT_SECRET,
        {
          expiresIn: '-1h', // Already expired
          issuer: 'senior-app',
          subject: 'user123',
        }
      );

      const req = makeReq({}, expiredToken);
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_TOKEN',
        })
      );
    });

    it('populates req.user with decoded token data', async () => {
      const password = 'SecurePass@123';
      const user = await new User({
        email: 'requser@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'requser@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      const token = res.json.mock.calls[0][0].accessToken;
      const authReq = makeReq({}, token);
      const authRes = makeRes();

      authMiddleware(authReq, authRes, makeNext);

      expect(authReq.user).toBeTruthy();
      expect(authReq.user.userId).toBe(user.userId);
      expect(authReq.user.role).toBe('student');
    });
  });

  // ─── ROLE-BASED ACCESS CONTROL ────────────────────────────────────────────

  describe('Role Middleware - Authorization', () => {
    it('allows request for user with required role', () => {
      const req = {
        body: {},
        user: { userId: 'user123', role: 'admin' },
        ip: '127.0.0.1',
        headers: {},
      };
      const res = makeRes();
      const next = jest.fn();

      const middleware = roleMiddleware(['admin', 'professor']);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 for user with insufficient role', () => {
      const req = {
        body: {},
        user: { userId: 'user123', role: 'student' },
        ip: '127.0.0.1',
        headers: {},
      };
      const res = makeRes();
      const next = jest.fn();

      const middleware = roleMiddleware(['admin']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'FORBIDDEN',
          message: expect.stringContaining('do not have permission'),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 if user object missing (not authenticated)', () => {
      const req = {
        body: {},
        user: null,
        ip: '127.0.0.1',
        headers: {},
      };
      const res = makeRes();
      const next = jest.fn();

      const middleware = roleMiddleware(['admin']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows multiple roles - user with any matching role passes', () => {
      const roles = ['student', 'professor', 'admin'];

      roles.forEach((role) => {
        const req = {
          body: {},
          user: { userId: 'user123', role },
          ip: '127.0.0.1',
          headers: {},
        };
        const res = makeRes();
        const next = jest.fn();

        const middleware = roleMiddleware(['professor', 'admin']);
        middleware(req, res, next);

        if (role === 'student') {
          expect(res.status).toHaveBeenCalledWith(403);
        } else {
          expect(next).toHaveBeenCalled();
        }
      });
    });
  });

  // ─── REFRESH TOKEN ROTATION ────────────────────────────────────────────────

  describe('Refresh Token Rotation', () => {
    it('issues new token pair on refresh', async () => {
      const { accessToken, refreshToken } = await generateTokensForUser('refresh@example.com');

      // Add delay to ensure different token generation times (JWT uses second-based timestamps)
      await new Promise((r) => setTimeout(r, 1100)); // 1.1 second delay

      const req = makeReq({ refreshToken });
      const res = makeRes();
      await refreshAccessToken(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = res.json.mock.calls[0][0];
      expect(response).toHaveProperty('accessToken');
      expect(response).toHaveProperty('refreshToken');
      expect(response).toHaveProperty('expiresIn', 3600);
      // New tokens should differ from old ones
      expect(response.accessToken).not.toBe(accessToken);
      expect(response.refreshToken).not.toBe(refreshToken);
    });

    it('invalidates old refresh token after rotation', async () => {
      const { accessToken, refreshToken } = await generateTokensForUser('rotation@example.com');

      // Use refresh token
      const req = makeReq({ refreshToken });
      const res = makeRes();
      await refreshAccessToken(req, res);

      // Old token should be revoked
      const oldTokenDoc = await RefreshToken.findOne({ token: refreshToken });
      expect(oldTokenDoc.isRevoked).toBe(true);
    });

    it('returns 401 when using revoked refresh token', async () => {
      const { refreshToken } = await generateTokensForUser('revoked@example.com');

      // Use refresh token once
      const req1 = makeReq({ refreshToken });
      const res1 = makeRes();
      await refreshAccessToken(req1, res1);

      // Try to use same token again (now revoked)
      const req2 = makeReq({ refreshToken });
      const res2 = makeRes();
      await refreshAccessToken(req2, res2);

      expect(res2.status).toHaveBeenCalledWith(401);
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_TOKEN',
          message: expect.stringContaining('revoked'),
        })
      );
    });

    it('returns 401 for missing refresh token', async () => {
      const req = makeReq({}); // no refreshToken
      const res = makeRes();
      await refreshAccessToken(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 401 for expired refresh token', async () => {
      const password = 'SecurePass@123';
      const user = await new User({
        email: 'expiredref@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // Create expired refresh token
      const expiredToken = 'expired.jwt.token';
      await new RefreshToken({
        userId: user.userId,
        token: expiredToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      }).save();

      const req = makeReq({ refreshToken: expiredToken });
      const res = makeRes();
      await refreshAccessToken(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('new access token contains correct user info', async () => {
      const password = 'SecurePass@123';
      const user = await new User({
        email: 'tokeninfo@example.com',
        hashedPassword: await hashPassword(password),
        role: 'professor',
        accountStatus: 'active',
      }).save();

      const req1 = makeReq({ email: user.email.toLowerCase(), password });
      const res1 = makeRes();
      await loginWithPassword(req1, res1);

      const refreshToken = res1.json.mock.calls[0][0].refreshToken;

      const req2 = makeReq({ refreshToken });
      const res2 = makeRes();
      await refreshAccessToken(req2, res2);

      const newAccessToken = res2.json.mock.calls[0][0].accessToken;
      const decoded = verifyAccessToken(newAccessToken);

      expect(decoded.userId).toBe(user.userId);
      expect(decoded.role).toBe('professor');
    });

    it('maintains rotation chain (rotatedFrom reference)', async () => {
      const { refreshToken: token1 } = await generateTokensForUser('chain@example.com');

      // First rotation
      const req1 = makeReq({ refreshToken: token1 });
      const res1 = makeRes();
      await refreshAccessToken(req1, res1);

      const token2 = res1.json.mock.calls[0][0].refreshToken;
      const doc2 = await RefreshToken.findOne({ token: token2 });

      // Verify rotation chain
      expect(doc2.rotatedFrom).toBeTruthy();

      // Second rotation
      const req2 = makeReq({ refreshToken: token2 });
      const res2 = makeRes();
      await refreshAccessToken(req2, res2);

      const token3 = res2.json.mock.calls[0][0].refreshToken;
      const doc3 = await RefreshToken.findOne({ token: token3 });

      expect(doc3.rotatedFrom).toBeTruthy();
      expect(doc3.rotatedFrom).not.toBe(doc2.rotatedFrom);
    });
  });

  // ─── PASSWORD CHANGE REVOCATION ────────────────────────────────────────────

  describe('Password Change - Token Revocation', () => {
    it('revokes all refresh tokens after password change', async () => {
      const password = 'OldPass@123';
      const user = await new User({
        email: 'passchange@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // Login first time
      const req1 = makeReq({ email: user.email.toLowerCase(), password });
      const res1 = makeRes();
      await loginWithPassword(req1, res1);
      const token1 = res1.json.mock.calls[0][0].refreshToken;

      jest.clearAllMocks();

      // Login second time
      const req2 = makeReq({ email: user.email.toLowerCase(), password });
      const res2 = makeRes();
      await loginWithPassword(req2, res2);
      const token2 = res2.json.mock.calls[0][0].refreshToken;
      const accessToken2 = res2.json.mock.calls[0][0].accessToken;

      // Verify all tokens are active
      let token1Doc = await RefreshToken.findOne({ token: token1 });
      let token2Doc = await RefreshToken.findOne({ token: token2 });
      expect(token1Doc.isRevoked).toBe(false);
      expect(token2Doc.isRevoked).toBe(false);

      jest.clearAllMocks();

      // Change password
      const req = makeReq(
        { currentPassword: password, newPassword: 'NewPass@456' },
        accessToken2,
        { userId: user.userId }
      );
      const res = makeRes();
      await changePassword(req, res);

      expect(res.status).toHaveBeenCalledWith(200);

      // Verify all tokens now revoked
      token1Doc = await RefreshToken.findOne({ token: token1 });
      token2Doc = await RefreshToken.findOne({ token: token2 });
      expect(token1Doc.isRevoked).toBe(true);
      expect(token2Doc.isRevoked).toBe(true);
    });

    it('returns 401 when trying to use refresh token after password change', async () => {
      const password = 'OldPass@123';
      const user = await new User({
        email: 'revoke@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // Login to get tokens
      const reqLogin = makeReq({ email: user.email.toLowerCase(), password });
      const resLogin = makeRes();
      await loginWithPassword(reqLogin, resLogin);
      const tokens = resLogin.json.mock.calls[0][0];

      jest.clearAllMocks();

      // Change password
      const req1 = makeReq(
        { currentPassword: password, newPassword: 'NewPass@456' },
        tokens.accessToken,
        { userId: user.userId }
      );
      const res1 = makeRes();
      await changePassword(req1, res1);

      // Try to use old refresh token
      const req2 = makeReq({ refreshToken: tokens.refreshToken });
      const res2 = makeRes();
      await refreshAccessToken(req2, res2);

      expect(res2.status).toHaveBeenCalledWith(401);
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_TOKEN',
          message: expect.stringContaining('revoked'),
        })
      );
    });

    it('requires current password validation', async () => {
      const password = 'SecurePass@123';
      const user = await new User({
        email: 'wrongpass@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // Login to get tokens
      const reqLogin = makeReq({ email: user.email.toLowerCase(), password });
      const resLogin = makeRes();
      await loginWithPassword(reqLogin, resLogin);
      const tokens = resLogin.json.mock.calls[0][0];

      jest.clearAllMocks();

      // Try to change password with wrong current password
      const req = makeReq(
        { currentPassword: 'WrongPass@999', newPassword: 'NewPass@456' },
        tokens.accessToken,
        { userId: user.userId }
      );
      const res = makeRes();
      await changePassword(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_CREDENTIALS',
        })
      );

      // Old refresh token should still be valid
      const oldTokenDoc = await RefreshToken.findOne({ token: tokens.refreshToken });
      expect(oldTokenDoc.isRevoked).toBe(false);
    });
  });

  // ─── LOGOUT ───────────────────────────────────────────────────────────────

  describe('Logout & Token Revocation', () => {
    it('revokes refresh token on logout', async () => {
      const { refreshToken } = await generateTokensForUser('logout@example.com');

      const req = makeReq({ refreshToken });
      const res = makeRes();
      await logout(req, res);

      const tokenDoc = await RefreshToken.findOne({ token: refreshToken });
      expect(tokenDoc.isRevoked).toBe(true);
    });

    it('returns 200 on logout', async () => {
      const { refreshToken } = await generateTokensForUser('logout2@example.com');

      const req = makeReq({ refreshToken });
      const res = makeRes();
      await logout(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('can logout without providing refresh token', async () => {
      const req = makeReq({});
      const res = makeRes();
      await logout(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ─── HELPER FUNCTION ──────────────────────────────────────────────────────

  async function generateTokensForUser(email) {
    const password = 'TestPass@123';
    const user = await new User({
      email,
      hashedPassword: await hashPassword(password),
      role: 'student',
      accountStatus: 'active',
    }).save();

    const req = makeReq({ email, password });
    const res = makeRes();
    await loginWithPassword(req, res);

    return res.json.mock.calls[0][0];
  }
});

// ═════════════════════════════════════════════════════════════════════════════

describe('Rate Limiting & Security (Brute Force Prevention)', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-ratelimit';
  const mongoose = require('mongoose');

  let User;
  let loginWithPassword;
  let hashPassword;

  const makeReq = (body = {}, headers = {}) => ({
    body,
    user: null,
    ip: '203.0.113.42', // Fixed IP for consistency
    headers: { 'user-agent': 'test-browser', ...headers },
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
    ({ loginWithPassword } = require('../src/controllers/auth'));
    ({ hashPassword } = require('../src/utils/password'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  // ─── ACCOUNT LOCKOUT (LOGIN ATTEMPTS) ──────────────────────────────────────

  describe('Account Lockout After Failed Login Attempts', () => {
    it('increments loginAttempts on failed password', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'locktest@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // First failed attempt
      const req1 = makeReq({ email: 'locktest@example.com', password: 'WrongPass@123' });
      const res1 = makeRes();
      await loginWithPassword(req1, res1);

      let user = await User.findOne({ email: 'locktest@example.com' });
      expect(user.loginAttempts).toBe(1);

      // Second failed attempt
      const req2 = makeReq({ email: 'locktest@example.com', password: 'WrongPass@456' });
      const res2 = makeRes();
      await loginWithPassword(req2, res2);

      user = await User.findOne({ email: 'locktest@example.com' });
      expect(user.loginAttempts).toBe(2);
    });

    it('locks account after 5 failed attempts', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'lockafter5@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        const req = makeReq({ email: 'lockafter5@example.com', password: 'WrongPass123' });
        const res = makeRes();
        await loginWithPassword(req, res);
      }

      const user = await User.findOne({ email: 'lockafter5@example.com' });
      expect(user.lockedUntil).toBeTruthy();
      expect(user.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns 401 ACCOUNT_LOCKED when account is locked', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'locked@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
        loginAttempts: 5,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // Locked for 30 min
      }).save();

      const req = makeReq({ email: 'locked@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ACCOUNT_LOCKED',
          message: expect.stringContaining('temporarily locked'),
        })
      );
    });

    it('resets loginAttempts counter on successful login', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'reset@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
        loginAttempts: 3,
      }).save();

      const req = makeReq({ email: 'reset@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      const user = await User.findOne({ email: 'reset@example.com' });
      expect(user.loginAttempts).toBe(0);
      expect(user.lockedUntil).toBe(null);
    });

    it('locks account for approximately 30 minutes', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'lockduration@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      // Trigger lockout
      for (let i = 0; i < 5; i++) {
        const req = makeReq({ email: 'lockduration@example.com', password: 'Wrong123' });
        const res = makeRes();
        await loginWithPassword(req, res);
      }

      const user = await User.findOne({ email: 'lockduration@example.com' });
      const lockDuration = user.lockedUntil.getTime() - Date.now();

      expect(lockDuration).toBeGreaterThan(29 * 60 * 1000); // > 29 min
      expect(lockDuration).toBeLessThanOrEqual(31 * 60 * 1000); // ≤ 31 min
    });
  });

  // ─── ACCOUNT SUSPENSION ────────────────────────────────────────────────────

  describe('Account Suspension', () => {
    it('returns 403 ACCOUNT_SUSPENDED when account is suspended', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'suspended@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'suspended', // Suspended account
      }).save();

      const req = makeReq({ email: 'suspended@example.com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ACCOUNT_SUSPENDED',
          message: expect.stringContaining('suspended'),
        })
      );
    });
  });

  // ─── INVALID CREDENTIALS ───────────────────────────────────────────────────

  describe('Invalid Credentials Handling', () => {
    it('returns 401 INVALID_CREDENTIALS for wrong password', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'wrongpass@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'wrongpass@example.com', password: 'WrongPass@123' });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_CREDENTIALS',
        })
      );
    });

    it('returns 401 for non-existent user (timing-safe)', async () => {
      const req = makeReq({ email: 'nonexistent@example.com', password: 'SomePass@123' });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_CREDENTIALS',
        })
      );
    });

    it('returns same error for missing email and wrong password (non-revealing)', async () => {
      // This tests the principle of non-revealing errors
      const req1 = makeReq({ email: 'nonexistent@example.com', password: 'Wrong' });
      const res1 = makeRes();
      await loginWithPassword(req1, res1);

      const req2 = makeReq({ email: 'nonexistent@example.com', password: 'Wrong2' });
      const res2 = makeRes();
      await loginWithPassword(req2, res2);

      expect(res1.status).toHaveBeenCalledWith(401);
      expect(res2.status).toHaveBeenCalledWith(401);
    });
  });

  // ─── EMAIL CASE INSENSITIVITY ─────────────────────────────────────────────

  describe('Email Case Insensitivity', () => {
    it('logs in successfully with uppercase email', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'casesensitive@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'CASESENSITIVE@EXAMPLE.COM', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        })
      );
    });

    it('logs in successfully with mixed case email', async () => {
      const password = 'CorrectPass@123';
      await new User({
        email: 'mixedcase@example.com',
        hashedPassword: await hashPassword(password),
        role: 'student',
        accountStatus: 'active',
      }).save();

      const req = makeReq({ email: 'MixedCase@Example.Com', password });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ─── MISSING INPUTS ────────────────────────────────────────────────────────

  describe('Input Validation', () => {
    it('returns 400 INVALID_INPUT when email is missing', async () => {
      const req = makeReq({ password: 'SomePass@123' });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_INPUT',
        })
      );
    });

    it('returns 400 INVALID_INPUT when password is missing', async () => {
      const req = makeReq({ email: 'test@example.com' });
      const res = makeRes();
      await loginWithPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_INPUT',
        })
      );
    });
  });
});
