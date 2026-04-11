/**
 * JIRA Integration Integration Tests
 *
 * Tests for groupIntegrations.js controller:
 *   configureJira (f13, f14, f15, f25) — validate credentials + project key, store config
 *   getJira                             — retrieve stored JIRA config
 *
 * Axios is mocked so no real HTTP calls are made.
 *
 * Run: npm test -- jiraIntegration.test.js
 */

const mongoose = require('mongoose');
const axios = require('axios');

jest.mock('axios');

describe('groupIntegrations — JIRA (f13-f15, f25)', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-jira-integration';

  let Group;
  let SyncErrorLog;
  let configureJira;
  let getJira;

  // ── Helpers ────────────────────────────────────────────────────────────────────

  const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
    params,
    body,
    user: { userId: 'usr_leader', role: 'student', ...userOverrides },
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

  const validJiraBody = (overrides = {}) => ({
    host: 'https://mycompany.atlassian.net',
    email: 'user@example.com',
    api_token: 'jira_token_abc',
    project_key: 'PROJ',
    ...overrides,
  });

  // JIRA API mock helpers
  const mockValidCredentials = () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: { accountId: 'acc_123' } });
  };

  const mockValidProject = (key = 'PROJ') => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: { key, name: 'My Project', id: '10001' },
    });
  };

  const mockInvalidCredentials = (status = 401) => {
    const err = new Error('Unauthorized');
    err.response = { status };
    axios.get.mockRejectedValueOnce(err);
  };

  const mockProjectNotFound = () => {
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
    ({ configureJira, getJira } = require('../src/controllers/groupIntegrations'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([Group.deleteMany({}), SyncErrorLog.deleteMany({})]);
    jest.clearAllMocks();
  });

  // ── configureJira happy path ───────────────────────────────────────────────────

  describe('POST /groups/:groupId/jira — configureJira', () => {
    it('returns 201 with project_id, project_key, binding, board_url on success', async () => {
      mockValidCredentials();
      mockValidProject('PROJ');

      const group = await makeGroup();
      const res = makeRes();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.project_id).toBe('10001');
      expect(body.project_key).toBe('PROJ');
      expect(body.binding).toBe('confirmed');
      expect(body.board_url).toBe('https://mycompany.atlassian.net/jira/software/projects/PROJ/boards');
    });

    it('f25: stores jiraUrl, jiraUsername, jiraToken, projectKey in D2 group record', async () => {
      mockValidCredentials();
      mockValidProject();

      const group = await makeGroup();

      await configureJira(
        makeReq({ groupId: group.groupId }, validJiraBody()),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId });
      expect(updated.jiraUrl).toBe('https://mycompany.atlassian.net');
      expect(updated.jiraUsername).toBe('user@example.com');
      expect(updated.jiraToken).toBe('jira_token_abc');
      expect(updated.projectKey).toBe('PROJ');
      expect(updated.jiraProject).toBe('My Project');
    });

    it('f14: makes credentials call to /rest/api/3/myself', async () => {
      mockValidCredentials();
      mockValidProject();

      const group = await makeGroup();
      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

      expect(axios.get).toHaveBeenCalledWith(
        'https://mycompany.atlassian.net/rest/api/3/myself',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
        })
      );
    });

    it('f15: makes project validation call to /rest/api/3/project/:key', async () => {
      mockValidCredentials();
      mockValidProject('PROJ');

      const group = await makeGroup();
      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

      expect(axios.get).toHaveBeenCalledWith(
        'https://mycompany.atlassian.net/rest/api/3/project/PROJ',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
        })
      );
    });

    it('strips trailing slash from host before storing', async () => {
      mockValidCredentials();
      mockValidProject();

      const group = await makeGroup();
      await configureJira(
        makeReq(
          { groupId: group.groupId },
          validJiraBody({ host: 'https://mycompany.atlassian.net/' })
        ),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId });
      expect(updated.jiraUrl).toBe('https://mycompany.atlassian.net');
    });

    // ── 400 validation ───────────────────────────────────────────────────────────

    it('returns 400 MISSING_HOST when host is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await configureJira(
        makeReq({ groupId: group.groupId }, validJiraBody({ host: undefined })),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_HOST');
    });

    it('returns 400 MISSING_EMAIL when email is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await configureJira(
        makeReq({ groupId: group.groupId }, validJiraBody({ email: undefined })),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_EMAIL');
    });

    it('returns 400 MISSING_API_TOKEN when api_token is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await configureJira(
        makeReq({ groupId: group.groupId }, validJiraBody({ api_token: undefined })),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_API_TOKEN');
    });

    it('returns 400 MISSING_PROJECT_KEY when project_key is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await configureJira(
        makeReq({ groupId: group.groupId }, validJiraBody({ project_key: undefined })),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_PROJECT_KEY');
    });

    // ── 403 / 404 ────────────────────────────────────────────────────────────────

    it('returns 403 FORBIDDEN when caller is not the group leader', async () => {
      const group = await makeGroup({ leaderId: 'usr_other' });
      const res = makeRes();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await configureJira(makeReq({ groupId: 'grp_none' }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    // ── 422 invalid credentials / project ────────────────────────────────────────

    it('returns 422 INVALID_JIRA_CREDENTIALS when JIRA returns 401', async () => {
      mockInvalidCredentials(401);

      const group = await makeGroup();
      const res = makeRes();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_JIRA_CREDENTIALS');
    });

    it('returns 422 INVALID_JIRA_CREDENTIALS when JIRA returns 403', async () => {
      mockInvalidCredentials(403);

      const group = await makeGroup();
      const res = makeRes();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_JIRA_CREDENTIALS');
    });

    it('returns 422 INVALID_PROJECT_KEY when project lookup returns 404', async () => {
      mockValidCredentials();
      mockProjectNotFound();

      const group = await makeGroup();
      const res = makeRes();

      await configureJira(
        makeReq({ groupId: group.groupId }, validJiraBody({ project_key: 'GHOST' })),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_PROJECT_KEY');
    });

    // ── 503 retry exhaustion ──────────────────────────────────────────────────────

    it('returns 503 JIRA_API_UNAVAILABLE after 3 network failures on credentials check', async () => {
      mockNetworkFailure(3);

      const group = await makeGroup();
      const res = makeRes();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0].code).toBe('JIRA_API_UNAVAILABLE');
    });

    it('writes SyncErrorLog entry after credentials check retry exhaustion', async () => {
      mockNetworkFailure(3);

      const group = await makeGroup();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

      const errLog = await SyncErrorLog.findOne({ service: 'jira', groupId: group.groupId });
      expect(errLog).not.toBeNull();
      expect(errLog.attempts).toBe(3);
    });

    it('returns 503 JIRA_API_UNAVAILABLE after 3 network failures on project lookup', async () => {
      mockValidCredentials();
      mockNetworkFailure(3);

      const group = await makeGroup();
      const res = makeRes();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0].code).toBe('JIRA_API_UNAVAILABLE');
    });

    it('writes SyncErrorLog entry after project lookup retry exhaustion', async () => {
      mockValidCredentials();
      mockNetworkFailure(3);

      const group = await makeGroup();

      await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

      const errLog = await SyncErrorLog.findOne({ service: 'jira', groupId: group.groupId });
      expect(errLog).not.toBeNull();
      expect(errLog.attempts).toBe(3);
    });
  });

  // ── getJira ────────────────────────────────────────────────────────────────────

  describe('GET /groups/:groupId/jira — getJira', () => {
    it('returns 200 with connected: true, project_key, board_url when config is set', async () => {
      const group = await makeGroup({
        jiraUrl: 'https://mycompany.atlassian.net',
        jiraProject: 'My Project',
        projectKey: 'PROJ',
        jiraBoardUrl: 'https://mycompany.atlassian.net/jira/software/projects/PROJ/boards',
        jiraUsername: 'user@example.com',
        jiraToken: 'tok_secret',
      });

      const res = makeRes();
      await getJira(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.connected).toBe(true);
      expect(body.project_key).toBe('PROJ');
      expect(body.board_url).toBe('https://mycompany.atlassian.net/jira/software/projects/PROJ/boards');
    });

    it('does not expose jiraToken in the response', async () => {
      const group = await makeGroup({
        jiraUrl: 'https://mycompany.atlassian.net',
        jiraToken: 'tok_secret',
      });

      const res = makeRes();
      await getJira(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.jiraToken).toBeUndefined();
    });

    it('returns connected: false when no JIRA config is set', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await getJira(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].connected).toBe(false);
      expect(res.json.mock.calls[0][0].project_key).toBeUndefined();
      expect(res.json.mock.calls[0][0].board_url).toBeUndefined();
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await getJira(makeReq({ groupId: 'grp_none' }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('returns last_sync_error when a SyncErrorLog entry exists for jira', async () => {
      const group = await makeGroup();
      await SyncErrorLog.create({
        service: 'jira',
        groupId: group.groupId,
        actorId: 'usr_leader',
        attempts: 3,
        lastError: 'ETIMEDOUT',
      });

      const res = makeRes();
      await getJira(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.last_sync_error).not.toBeNull();
      expect(body.last_sync_error.attempts).toBe(3);
      expect(body.last_sync_error.last_error).toBe('ETIMEDOUT');
      expect(body.last_sync_error.error_id).toBeDefined();
      expect(body.last_sync_error.timestamp).toBeDefined();
    });

    it('returns last_sync_error: null when no SyncErrorLog entry exists', async () => {
      const group = await makeGroup({ jiraUrl: 'https://mycompany.atlassian.net' });
      const res = makeRes();

      await getJira(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.last_sync_error).toBeNull();
    });

    it('returns the most recent SyncErrorLog entry when multiple exist', async () => {
      const group = await makeGroup();
      await SyncErrorLog.create({
        service: 'jira',
        groupId: group.groupId,
        actorId: 'usr_leader',
        attempts: 3,
        lastError: 'first error',
      });
      await SyncErrorLog.create({
        service: 'jira',
        groupId: group.groupId,
        actorId: 'usr_leader',
        attempts: 3,
        lastError: 'second error',
      });

      const res = makeRes();
      await getJira(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.last_sync_error.last_error).toBe('second error');
    });
  });
});
