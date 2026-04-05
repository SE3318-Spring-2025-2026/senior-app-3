/**
 * GitHub OAuth Integration Tests
 *
 * Covers:
 *  - POST /auth/github/oauth/initiate — state token generation, authorizationUrl shape
 *  - GET  /auth/github/oauth/callback — CSRF validation, token exchange, GitHub API call,
 *    uniqueness enforcement, user update, audit log, redirect behaviour
 *
 * External HTTP calls (GitHub APIs) are mocked via jest.mock so no real network
 * traffic occurs and tests run without GitHub credentials.
 *
 * Run: npm test -- --testPathPattern=github-oauth
 */

const mongoose = require('mongoose');
const axios = require('axios');

// ── Mock axios before importing the controller ────────────────────────────────
jest.mock('axios');

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeReq = (opts = {}) => ({
  body: opts.body || {},
  query: opts.query || {},
  user: opts.user || null,
  ip: '127.0.0.1',
  headers: { 'user-agent': 'test-agent', ...(opts.headers || {}) },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  return res;
};

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('GitHub OAuth (integration)', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-github-oauth';

  let User;
  let AuditLog;
  let hashPassword;
  let initiateGithubOAuth;
  let githubOAuthCallback;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    // Load modules after DB is ready so they share the same mongoose instance
    User = require('../src/models/User');
    AuditLog = require('../src/models/AuditLog');
    ({ hashPassword } = require('../src/utils/password'));
    ({ initiateGithubOAuth, githubOAuthCallback } = require('../src/controllers/auth'));

    // Set env vars used by the controller
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
    process.env.GITHUB_REDIRECT_URI = 'http://localhost:5000/api/v1/auth/github/oauth/callback';
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await AuditLog.deleteMany({});
    jest.clearAllMocks();
  });

  // ── Helper: create a test user ───────────────────────────────────────────────

  const createUser = async (overrides = {}) =>
    new User({
      email: 'user@example.com',
      hashedPassword: await hashPassword('T3st_Secure#99'),
      role: 'student',
      accountStatus: 'active',
      ...overrides,
    }).save();

  // ── initiateGithubOAuth ──────────────────────────────────────────────────────

  describe('initiateGithubOAuth', () => {
    it('returns 200 with authorizationUrl and state', async () => {
      const user = await createUser();
      const req = makeReq({ user: { userId: user.userId } });
      const res = makeRes();

      await initiateGithubOAuth(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.state).toBeDefined();
      expect(body.authorizationUrl).toContain('https://github.com/login/oauth/authorize');
    });

    it('authorizationUrl contains client_id, redirect_uri, state, and scope', async () => {
      const user = await createUser({ email: 'urlcheck@example.com' });
      const req = makeReq({ user: { userId: user.userId } });
      const res = makeRes();

      await initiateGithubOAuth(req, res);

      const { authorizationUrl, state } = res.json.mock.calls[0][0];
      expect(authorizationUrl).toContain('client_id=test-client-id');
      expect(authorizationUrl).toContain(encodeURIComponent(process.env.GITHUB_REDIRECT_URI));
      expect(authorizationUrl).toContain(`state=${state}`);
      expect(authorizationUrl).toContain('scope=read:user');
    });

    it('each call generates a unique state token', async () => {
      const user = await createUser({ email: 'unique@example.com' });
      const req1 = makeReq({ user: { userId: user.userId } });
      const req2 = makeReq({ user: { userId: user.userId } });
      const res1 = makeRes();
      const res2 = makeRes();

      await initiateGithubOAuth(req1, res1);
      await initiateGithubOAuth(req2, res2);

      const state1 = res1.json.mock.calls[0][0].state;
      const state2 = res2.json.mock.calls[0][0].state;
      expect(state1).not.toBe(state2);
    });
  });

  // ── githubOAuthCallback ──────────────────────────────────────────────────────

  describe('githubOAuthCallback', () => {
    // Helper: run initiate and capture the state token
    const initiateAndGetState = async (userId) => {
      const req = makeReq({ user: { userId } });
      const res = makeRes();
      await initiateGithubOAuth(req, res);
      return res.json.mock.calls[0][0].state;
    };

    // Helper: mock a successful GitHub token exchange + user fetch
    const mockGithubSuccess = (login = 'octocat', id = 1) => {
      axios.post.mockResolvedValueOnce({ data: { access_token: 'gha_fake_token' } });
      axios.get.mockResolvedValueOnce({ data: { login, id } });
    };

    it('redirects with MISSING_PARAMS when code or state absent', async () => {
      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: {} }), res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=MISSING_PARAMS')
      );
    });

    it('redirects with the GitHub error when GitHub sends an error param', async () => {
      const res = makeRes();
      await githubOAuthCallback(
        makeReq({ query: { error: 'access_denied', code: 'x', state: 'y' } }),
        res
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=access_denied')
      );
    });

    it('redirects with INVALID_STATE for an unknown state token', async () => {
      const res = makeRes();
      await githubOAuthCallback(
        makeReq({ query: { code: 'somecode', state: 'completely-wrong-state' } }),
        res
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=INVALID_STATE')
      );
    });

    it('state token is one-time use — second callback with same state gets INVALID_STATE', async () => {
      const user = await createUser({ email: 'onetimeuse@example.com' });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('first-use', 100);
      const res1 = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c1', state } }), res1);
      // First call should succeed (redirect with status=linked)
      expect(res1.redirect).toHaveBeenCalledWith(expect.stringContaining('status=linked'));

      // Second call with the same state should fail
      const res2 = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c2', state } }), res2);
      expect(res2.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=INVALID_STATE')
      );
    });

    it('redirects with TOKEN_EXCHANGE_FAILED when GitHub returns an error in token response', async () => {
      const user = await createUser({ email: 'exchangefail@example.com' });
      const state = await initiateAndGetState(user.userId);

      axios.post.mockResolvedValueOnce({
        data: { error: 'bad_verification_code', error_description: 'The code is invalid.' },
      });

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'badcode', state } }), res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=TOKEN_EXCHANGE_FAILED')
      );
    });

    it('redirects with TOKEN_EXCHANGE_FAILED when token exchange throws', async () => {
      const user = await createUser({ email: 'exchangethrow@example.com' });
      const state = await initiateAndGetState(user.userId);

      axios.post.mockRejectedValueOnce(new Error('Network error'));

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=TOKEN_EXCHANGE_FAILED')
      );
    });

    it('redirects with GITHUB_API_FAILED when the /user API call throws', async () => {
      const user = await createUser({ email: 'apifail@example.com' });
      const state = await initiateAndGetState(user.userId);

      axios.post.mockResolvedValueOnce({ data: { access_token: 'gha_token' } });
      axios.get.mockRejectedValueOnce(new Error('GitHub API down'));

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=GITHUB_API_FAILED')
      );
    });

    it('redirects with GITHUB_ALREADY_LINKED when githubId belongs to another account', async () => {
      // Another user already has this GitHub ID
      await createUser({
        email: 'owner@example.com',
        githubId: '9999',
        githubUsername: 'existinguser',
      });

      const user = await createUser({ email: 'newcomer@example.com' });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('existinguser', 9999); // same githubId

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=GITHUB_ALREADY_LINKED')
      );
    });

    it('redirects with GITHUB_USERNAME_TAKEN when githubUsername belongs to another account', async () => {
      // Another user already has this GitHub username (different ID)
      await createUser({
        email: 'usernameowner@example.com',
        githubId: '1111',
        githubUsername: 'takenname',
      });

      const user = await createUser({ email: 'usernamenewcomer@example.com' });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('takenname', 2222); // same username, different ID

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=GITHUB_USERNAME_TAKEN')
      );
    });

    it('saves githubUsername and githubId on success', async () => {
      const user = await createUser({ email: 'savetest@example.com' });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('octocat', 42);

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);

      const updated = await User.findOne({ userId: user.userId });
      expect(updated.githubUsername).toBe('octocat');
      expect(updated.githubId).toBe('42');
    });

    it('redirects to frontend with status=linked and githubUsername on success', async () => {
      const user = await createUser({ email: 'successredirect@example.com' });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('octocat', 99);

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:3000/auth/github/callback')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('status=linked')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('githubUsername=octocat')
      );
    });

    it('creates a GITHUB_OAUTH_LINKED audit log on success', async () => {
      const user = await createUser({ email: 'auditlink@example.com' });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('octokitten', 77);

      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), makeRes());

      const log = await AuditLog.findOne({ action: 'GITHUB_OAUTH_LINKED' });
      expect(log).toBeTruthy();
      expect(log.actorId).toBe(user.userId);
    });

    it('linking the same GitHub account again (idempotent) succeeds', async () => {
      const user = await createUser({
        email: 'idempotent@example.com',
        githubId: '55',
        githubUsername: 'samecat',
      });
      const state = await initiateAndGetState(user.userId);

      mockGithubSuccess('samecat', 55); // same account already linked

      const res = makeRes();
      await githubOAuthCallback(makeReq({ query: { code: 'c', state } }), res);

      // Should succeed — not treated as a conflict
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('status=linked')
      );
    });
  });
});
