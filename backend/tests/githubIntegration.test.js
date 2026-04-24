/**
 * GitHub Integration Integration Tests
 *
 * Tests for groupIntegrations.js controller:
 *   configureGithub (f10, f11, f12, f24) — validate PAT + org, store config
 *   getGithub                             — retrieve stored GitHub config
 *
 * Axios is mocked so no real HTTP calls are made.
 *
 * Run: npm test -- githubIntegration.test.js
 */

const mongoose = require('mongoose');
const axios = require('axios');
const { decrypt } = require('../src/utils/cryptoUtils');

jest.mock('axios');

describe('groupIntegrations — GitHub (f10-f12, f24)', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-github-integration';

  let Group;
  let SyncErrorLog;
  let AuditLog;
  let configureGithub;
  let getGithub;

  // ── Helpers ────────────────────────────────────────────────────────────────────

  const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
    params,
    body,
    user: { userId: 'usr_leader', role: 'coordinator', ...userOverrides },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const makeGroup = (overrides = {}) =>
    Group.create({
      groupName: `Test Group ${Date.now()}-${Math.random()}`,
      leaderId: 'usr_leader',
      status: 'active',
      ...overrides,
    });

  // GitHub API mock helpers
  const mockValidPat = () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: { login: 'usr_leader' },
      headers: { 'x-oauth-scopes': 'repo:status, read:org' },
    });
  };

  const mockValidOrg = (orgName = 'my-org') => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: { login: orgName, id: 42, name: 'My Org' },
    });
  };

  const mockInvalidPat = () => {
    const err = new Error('Unauthorized');
    err.response = { status: 401 };
    axios.get.mockRejectedValueOnce(err);
  };

  const mockForbiddenPat = () => {
    const err = new Error('Forbidden');
    err.response = { status: 403 };
    axios.get.mockRejectedValueOnce(err);
  };

  const mockOrgNotFound = () => {
    const err = new Error('Not Found');
    err.response = { status: 404 };
    axios.get.mockRejectedValueOnce(err);
  };

  const mockNetworkFailure = (times = 3) => {
    const err = new Error('ETIMEDOUT');
    for (let i = 0; i < times; i++) {
      axios.get.mockRejectedValueOnce(err);
    }
  };

  // ── Setup / teardown ───────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    Group = require('../src/models/Group');
    SyncErrorLog = require('../src/models/SyncErrorLog');
    AuditLog = require('../src/models/AuditLog');
    ({ configureGithub, getGithub } = require('../src/controllers/groupIntegrations'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([Group.deleteMany({}), SyncErrorLog.deleteMany({}), AuditLog.deleteMany({})]);
    jest.clearAllMocks();
  });

  // ── configureGithub happy path ─────────────────────────────────────────────────

  describe('POST /groups/:groupId/github — configureGithub', () => {
    it('returns 201 with repo_url, status, org_data on success', async () => {
      mockValidPat();
      mockValidOrg('cool-org');

      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_validtoken', org_name: 'cool-org', repo_name: 'my-repo', visibility: 'private' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.status).toBe('created');
      expect(body.repo_url).toBe('https://github.com/cool-org/my-repo');
      expect(body.org_data).toMatchObject({ login: 'cool-org', id: 42 });
    });

    it('f24: stores encrypted githubPat and persists integration metadata in D2', async () => {
      mockValidPat();
      mockValidOrg('my-org');

      const group = await makeGroup();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_secret', org_name: 'my-org', repo_name: 'test-repo', visibility: 'public' }),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId }).select('+githubPat');
      expect(updated.githubPat).toBeDefined();
      expect(updated.githubPat).not.toBe('ghp_secret');
      expect(updated.githubPat).toMatch(/^v1:/);
      expect(decrypt(updated.githubPat)).toBe('ghp_secret');
      expect(updated.githubOrg).toBe('my-org');
      expect(updated.githubRepoName).toBe('test-repo');
      expect(updated.githubVisibility).toBe('public');
    });

    it('f11: makes PAT validation call to https://api.github.com/user', async () => {
      mockValidPat();
      mockValidOrg();

      const group = await makeGroup();
      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_token', org_name: 'my-org', repo_name: 'my-repo' }),
        makeRes()
      );

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghp_token' }),
        })
      );
    });

    it('f12: makes org data call to https://api.github.com/orgs/:org', async () => {
      mockValidPat();
      mockValidOrg('target-org');

      const group = await makeGroup();
      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_token', org_name: 'target-org', repo_name: 'my-repo' }),
        makeRes()
      );

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.github.com/orgs/target-org',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghp_token' }),
        })
      );
    });

    // ── 400 validation ───────────────────────────────────────────────────────────

    it('returns 400 MISSING_PAT when pat is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(makeReq({ groupId: group.groupId }, { org_name: 'my-org', repo_name: 'my-repo' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_PAT');
    });

    it('returns 400 MISSING_ORG when org_name is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_x', repo_name: 'my-repo' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_ORG');
    });

    // ── 403 / 404 ────────────────────────────────────────────────────────────────

    it('returns 403 FORBIDDEN and writes SECURITY_AUDIT when caller is not coordinator', async () => {
      const group = await makeGroup({ leaderId: 'usr_other' });
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_x', org_name: 'org', repo_name: 'repo' }, { role: 'leader' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
      const audit = await AuditLog.findOne({ action: 'SECURITY_AUDIT', groupId: group.groupId }).sort({ createdAt: -1 });
      expect(audit).not.toBeNull();
      expect(audit.actorId).toBe('usr_leader');
      expect(audit.payload).toMatchObject({
        provider: 'github',
        reason: 'role_not_permitted',
        statusCode: 403,
      });
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: 'grp_none' }, { pat: 'ghp_x', org_name: 'org', repo_name: 'repo' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    // ── 422 invalid credentials / org ────────────────────────────────────────────

    it('returns 422 INVALID_PAT when GitHub returns 401', async () => {
      mockInvalidPat();

      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_bad', org_name: 'my-org', repo_name: 'my-repo' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_PAT');
    });

    it('returns 422 INVALID_PAT when GitHub returns 403', async () => {
      mockForbiddenPat();

      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_bad', org_name: 'my-org', repo_name: 'my-repo' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_PAT');
    });

    it('returns 422 ORG_NOT_FOUND when org lookup returns 404', async () => {
      mockValidPat();
      mockOrgNotFound();

      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_valid', org_name: 'ghost-org', repo_name: 'my-repo' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].code).toBe('ORG_NOT_FOUND');
    });

    // ── 503 retry exhaustion ──────────────────────────────────────────────────────

    it('returns 503 GITHUB_API_UNAVAILABLE after 3 network failures on PAT validation', async () => {
      mockNetworkFailure(3);

      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_timeout', org_name: 'my-org', repo_name: 'my-repo' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0].code).toBe('GITHUB_API_UNAVAILABLE');
    });

    it('writes SyncErrorLog entry after PAT validation retry exhaustion', async () => {
      mockNetworkFailure(3);

      const group = await makeGroup();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_timeout', org_name: 'my-org', repo_name: 'my-repo' }),
        makeRes()
      );

      const errLog = await SyncErrorLog.findOne({ service: 'github', groupId: group.groupId });
      expect(errLog).not.toBeNull();
      expect(errLog.attempts).toBe(3);
    });

    it('returns 503 GITHUB_API_UNAVAILABLE after 3 network failures on org lookup', async () => {
      mockValidPat();
      mockNetworkFailure(3);

      const group = await makeGroup();
      const res = makeRes();

      await configureGithub(
        makeReq({ groupId: group.groupId }, { pat: 'ghp_valid', org_name: 'my-org', repo_name: 'my-repo' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0].code).toBe('GITHUB_API_UNAVAILABLE');
    });
  });

  // ── getGithub ──────────────────────────────────────────────────────────────────

  describe('GET /groups/:groupId/github — getGithub', () => {
    it('returns 200 with group_id, github_org, validated: true when config is set', async () => {
      const group = await makeGroup({
        githubOrg: 'stored-org',
        githubRepoUrl: 'https://github.com/stored-org/repo',
        githubPat: 'ghp_stored',
      });
      const res = makeRes();

      await getGithub(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.group_id).toBe(group.groupId);
      expect(body.github_org).toBe('stored-org');
      expect(body.validated).toBe(true);
    });

    it('does not expose githubPat in the response', async () => {
      const group = await makeGroup({
        githubOrg: 'stored-org',
        githubRepoUrl: 'https://github.com/stored-org/repo',
        githubPat: 'ghp_secret',
      });
      const res = makeRes();

      await getGithub(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.githubPat).toBeUndefined();
      expect(body.token_masked).toBe('****');
    });

    it('returns validated: false when no GitHub config is set', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await getGithub(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].validated).toBe(false);
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await getGithub(makeReq({ groupId: 'grp_none' }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('returns last_sync_error when a SyncErrorLog entry exists for github', async () => {
      const group = await makeGroup();
      await SyncErrorLog.create({
        service: 'github',
        groupId: group.groupId,
        actorId: 'usr_leader',
        attempts: 3,
        lastError: 'ETIMEDOUT',
      });

      const res = makeRes();
      await getGithub(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.last_sync_error).not.toBeNull();
      expect(body.last_sync_error.attempts).toBe(3);
      expect(body.last_sync_error.last_error).toBe('ETIMEDOUT');
      expect(body.last_sync_error.error_id).toBeDefined();
      expect(body.last_sync_error.timestamp).toBeDefined();
    });

    it('returns last_sync_error: null when no SyncErrorLog entry exists', async () => {
      const group = await makeGroup({ githubOrg: 'clean-org' });
      const res = makeRes();

      await getGithub(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.last_sync_error).toBeNull();
    });

    it('returns the most recent SyncErrorLog entry when multiple exist', async () => {
      const group = await makeGroup();
      await SyncErrorLog.create({
        service: 'github',
        groupId: group.groupId,
        actorId: 'usr_leader',
        attempts: 3,
        lastError: 'first error',
      });
      await SyncErrorLog.create({
        service: 'github',
        groupId: group.groupId,
        actorId: 'usr_leader',
        attempts: 3,
        lastError: 'second error',
      });

      const res = makeRes();
      await getGithub(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.last_sync_error.last_error).toBe('second error');
    });
  });
});
