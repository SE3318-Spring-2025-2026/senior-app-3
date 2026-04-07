/**
 * External API Integration Tests: GitHub, JIRA, Notification Service
 *
 * Comprehensive test suite for:
 * ✓ GitHub API integration with retry logic
 * ✓ JIRA API integration with retry logic
 * ✓ Notification Service integration with retry logic
 * ✓ Sync error log creation after max retries
 * ✓ Proper error responses (422/503)
 * ✓ Complete setup flows (GitHub, JIRA, Notifications)
 *
 * References:
 *   OpenAPI: POST/GET /groups/{group_id}/github (2.6)
 *   OpenAPI: POST/GET /groups/{group_id}/jira (2.7)
 *   OpenAPI: POST /groups/{group_id}/notifications (2.4)
 *   DFD Flows: f10-f12, f13-f15, f24-f25, f07
 *
 * Acceptance Criteria:
 *   ✓ Valid GitHub PAT → 201 with repo_url and org_data
 *   ✓ Invalid GitHub PAT → 422 immediately (no retries)
 *   ✓ GitHub API timeout × 3 → sync error log + 503
 *   ✓ Valid JIRA credentials → 201 with project_id and board_url
 *   ✓ Invalid JIRA project key → 422 immediately (no retries)
 *   ✓ JIRA API timeout × 3 → sync error log + 503
 *   ✓ Notification dispatch → 201 with notification_id
 *   ✓ Notification Service failure → error logged, not silently swallowed
 *   ✓ Sync error log contains: api_type, group_id, retry_count, last_error, timestamp
 *   ✓ GET status endpoints reflect error state after failed setup
 *
 * Run: npm test -- external-api-github-jira-notifications.test.js
 */

const mongoose = require('mongoose');
const request = require('supertest');
const axios = require('axios');
const app = require('../src/index');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const SyncErrorLog = require('../src/models/SyncErrorLog');
const MemberInvitation = require('../src/models/MemberInvitation');
const AuditLog = require('../src/models/AuditLog');
const { hashPassword } = require('../src/utils/password');
const { generateTokenPair } = require('../src/utils/jwt');

// Mock axios for all external API calls
jest.mock('axios');

const MONGO_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-integrations';

describe('External API Integration: GitHub, JIRA, Notifications', () => {
  let leader;
  let group;
  let leaderToken;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(MONGO_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    // Clean database
    await User.deleteMany({});
    await Group.deleteMany({});
    await SyncErrorLog.deleteMany({});
    await MemberInvitation.deleteMany({});
    await AuditLog.deleteMany({});

    // Create test leader
    leader = await User.create({
      email: 'leader@university.edu',
      hashedPassword: await hashPassword('TempPass1!'),
      role: 'student',
      accountStatus: 'active',
      emailVerified: true,
      requiresPasswordChange: false,
    });

    const tokens = generateTokenPair(leader.userId, 'student');
    leaderToken = tokens.accessToken;

    // Create test group
    group = await Group.create({
      groupName: 'Test Integration Group',
      leaderId: leader.userId,
      status: 'pending_validation',
      members: [
        {
          userId: leader.userId,
          role: 'leader',
          status: 'accepted',
          joinedAt: new Date(),
        },
      ],
    });

    // Clear mocks
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ──── GITHUB API TESTS ────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────────

  describe('GitHub Configuration (POST /groups/:groupId/github)', () => {
    it('should successfully configure GitHub with valid PAT (201 response)', async () => {
      const mockOrgData = {
        login: 'test-org',
        id: 12345,
        name: 'Test Organization',
      };

      axios.get
        .mockResolvedValueOnce({ data: { login: 'testuser', id: 999 } }) // PAT validation
        .mockResolvedValueOnce({ data: mockOrgData }); // Org data retrieval

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('github_org', 'test-org');
      expect(res.body).toHaveProperty('github_repo_url');
      expect(res.body).toHaveProperty('validated', true);
      expect(res.body).toHaveProperty('org_data');
      expect(res.body.org_data.login).toBe('test-org');
      expect(res.body.org_data.id).toBe(12345);

      // Verify group was updated in DB
      const updatedGroup = await Group.findOne({ groupId: group.groupId });
      expect(updatedGroup.githubOrg).toBe('test-org');
      expect(updatedGroup.githubPat).toBe('ghp_validtoken123');
      expect(updatedGroup.githubRepoUrl).toBe('https://github.com/test-org');

      // Verify axios was called correctly
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(axios.get.mock.calls[0][0]).toContain('api.github.com/user');
      expect(axios.get.mock.calls[1][0]).toContain('api.github.com/orgs/test-org');
    });

    it('should return 422 for invalid GitHub PAT (401 from API)', async () => {
      axios.get.mockRejectedValueOnce({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_invalidtoken',
          org: 'test-org',
        });

      // Should fail on PAT validation attempt
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PAT');

      // Should NOT create SyncErrorLog on 4xx errors (no retry needed)
      const syncLogs = await SyncErrorLog.find({ groupId: group.groupId });
      expect(syncLogs.length).toBe(0);

      // axios should only be called once (PAT validation fails immediately on 4xx)
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should return 422 for invalid GitHub org (404 from API)', async () => {
      axios.get
        .mockResolvedValueOnce({ data: { login: 'testuser', id: 999 } }) // PAT valid
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: 'Not Found',
        }); // Org not found

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'nonexistent-org',
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ORG_NOT_FOUND');

      // Should NOT create SyncErrorLog on 4xx errors
      const syncLogs = await SyncErrorLog.find({ groupId: group.groupId });
      expect(syncLogs.length).toBe(0);
    });

    it('should retry on timeout and succeed on 2nd attempt (valid scenario)', async () => {
      const mockOrgData = {
        login: 'test-org',
        id: 12345,
        name: 'Test Organization',
      };

      // Simulate: PAT validation timeout on attempt 1, succeeds on attempt 2
      axios.get
        .mockRejectedValueOnce(new Error('Timeout')) // PAT validation attempt 1 fails
        .mockResolvedValueOnce({ data: { login: 'testuser', id: 999 } }) // PAT validation attempt 2 succeeds
        .mockResolvedValueOnce({ data: mockOrgData }); // Org data retrieval

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      expect(res.status).toBe(201);
      expect(res.body.validated).toBe(true);

      // Should NOT create SyncErrorLog (succeeded before max retries)
      const syncLogs = await SyncErrorLog.find({ groupId: group.groupId });
      expect(syncLogs.length).toBe(0);

      // Verify retries happened
      expect(axios.get).toHaveBeenCalledTimes(3); // Retry PAT validation + succeeded, then org data
    });

    it('should create SyncErrorLog after 3 GitHub API timeouts and return 503', async () => {
      // Simulate 3 consecutive timeout failures
      axios.get
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('GITHUB_API_UNAVAILABLE');

      // Verify SyncErrorLog was created
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'github',
      });
      expect(syncLogs.length).toBe(1);

      const log = syncLogs[0];
      expect(log.service).toBe('github');
      expect(log.groupId).toBe(group.groupId);
      expect(log.actorId).toBe(leader.userId);
      expect(log.attempts).toBe(3);
      expect(log.lastError).toContain('Timeout');
      expect(log.createdAt).toBeDefined(); // timestamp
      expect(log.updatedAt).toBeDefined(); // timestamp
    });

    it('should return 400 when PAT is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          org: 'test-org',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_PAT');
    });

    it('should return 400 when org is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_ORG');
    });

    it('should return 403 when non-leader tries to configure GitHub', async () => {
      const otherStudent = await User.create({
        email: 'other@university.edu',
        hashedPassword: await hashPassword('TempPass1!'),
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });

      const { accessToken } = generateTokenPair(otherStudent.userId, 'student');

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should return 404 when group does not exist', async () => {
      const res = await request(app)
        .post(`/api/v1/groups/nonexistent-group/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('GitHub Status (GET /groups/:groupId/github)', () => {
    it('should return connected:true after successful GitHub setup', async () => {
      // Pre-setup group with GitHub config
      await Group.findOneAndUpdate(
        { groupId: group.groupId },
        {
          $set: {
            githubOrg: 'test-org',
            githubRepoUrl: 'https://github.com/test-org',
          },
        }
      );

      const res = await request(app)
        .get(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.group_id).toBe(group.groupId);
      expect(res.body.github_org).toBe('test-org');
      expect(res.body.validated).toBe(true);
    });

    it('should return connected:false before GitHub setup', async () => {
      const res = await request(app)
        .get(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.group_id).toBe(group.groupId);
      expect(res.body.github_org).toBeNull();
      expect(res.body.validated).toBe(false);
    });

    it('should return 404 for non-existent group', async () => {
      const res = await request(app)
        .get(`/api/v1/groups/nonexistent-group/github`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(res.status).toBe(404);
    });

    it('should return connected:false (error state) after failed setup attempt', async () => {
      // First attempt: invalid PAT (fails)
      axios.get.mockRejectedValueOnce({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const failRes = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_invalidtoken',
          org: 'test-org',
        });

      expect(failRes.status).toBe(422);

      // Second: GET should show connected:false (error state)
      const getRes = await request(app)
        .get(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.validated).toBe(false);
      expect(getRes.body.github_org).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ──── JIRA API TESTS ──────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────────

  describe('JIRA Configuration (POST /groups/:groupId/jira)', () => {
    it('should successfully configure JIRA with valid credentials (200 response)', async () => {
      const mockProjectData = {
        id: 10000,
        key: 'PROJ',
        name: 'Test Project',
      };

      axios.get
        .mockResolvedValueOnce({ data: { accountId: 'user123' } }) // Credentials validation
        .mockResolvedValueOnce({ data: mockProjectData }); // Project data retrieval

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'testuser',
          jira_token: 'jira_token_123',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('jira_url', 'https://jira.company.com');
      expect(res.body).toHaveProperty('jira_project', 'Test Project');
      expect(res.body).toHaveProperty('jira_project_key', 'PROJ');
      expect(res.body).toHaveProperty('jira_board_url');
      expect(res.body).toHaveProperty('validated', true);
      expect(res.body.jira_board_url).toContain('PROJ');

      // Verify group was updated in DB
      const updatedGroup = await Group.findOne({ groupId: group.groupId });
      expect(updatedGroup.jiraUrl).toBe('https://jira.company.com');
      expect(updatedGroup.projectKey).toBe('PROJ');
      expect(updatedGroup.jiraUsername).toBe('testuser');
      expect(updatedGroup.jiraToken).toBe('jira_token_123');

      // Verify axios was called correctly
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(axios.get.mock.calls[0][0]).toContain('/rest/api/3/myself');
      expect(axios.get.mock.calls[1][0]).toContain('/rest/api/3/project/PROJ');
    });

    it('should return 422 for invalid JIRA credentials (401 from API)', async () => {
      axios.get.mockRejectedValueOnce({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'invalid_user',
          jira_token: 'invalid_token',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_JIRA_CREDENTIALS');

      // Should NOT create SyncErrorLog on 4xx errors
      const syncLogs = await SyncErrorLog.find({ groupId: group.groupId });
      expect(syncLogs.length).toBe(0);
    });

    it('should return 422 for invalid JIRA project key (404 from API)', async () => {
      axios.get
        .mockResolvedValueOnce({ data: { accountId: 'user123' } }) // Credentials valid
        .mockRejectedValueOnce({
          response: { status: 404 },
          message: 'Not Found',
        }); // Project not found

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'testuser',
          jira_token: 'jira_token_123',
          project_key: 'INVALID',
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PROJECT_KEY');

      // Should NOT create SyncErrorLog on 4xx errors
      const syncLogs = await SyncErrorLog.find({ groupId: group.groupId });
      expect(syncLogs.length).toBe(0);
    });

    it('should retry on timeout and succeed on 2nd attempt (JIRA credentials)', async () => {
      const mockProjectData = {
        id: 10000,
        key: 'PROJ',
        name: 'Test Project',
      };

      axios.get
        .mockRejectedValueOnce(new Error('Timeout')) // Credentials validation attempt 1
        .mockResolvedValueOnce({ data: { accountId: 'user123' } }) // Credentials validation attempt 2
        .mockResolvedValueOnce({ data: mockProjectData }); // Project data

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'testuser',
          jira_token: 'jira_token_123',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(201);
      expect(res.body.validated).toBe(true);

      // Should NOT create SyncErrorLog (succeeded before max retries)
      const syncLogs = await SyncErrorLog.find({ groupId: group.groupId });
      expect(syncLogs.length).toBe(0);
    });

    it('should create SyncErrorLog after 3 JIRA API timeouts and return 503', async () => {
      // Simulate 3 consecutive timeout failures on credentials validation
      axios.get
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'testuser',
          jira_token: 'jira_token_123',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('JIRA_API_UNAVAILABLE');

      // Verify SyncErrorLog was created
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'jira',
      });
      expect(syncLogs.length).toBe(1);

      const log = syncLogs[0];
      expect(log.service).toBe('jira');
      expect(log.groupId).toBe(group.groupId);
      expect(log.actorId).toBe(leader.userId);
      expect(log.attempts).toBe(3);
      expect(log.lastError).toContain('Timeout');
    });

    it('should return 400 when required JIRA fields are missing', async () => {
      // Missing jira_url
      let res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_username: 'testuser',
          jira_token: 'jira_token_123',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_JIRA_URL');

      // Missing jira_username
      res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_token: 'jira_token_123',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_JIRA_USERNAME');
    });

    it('should return 403 when non-leader tries to configure JIRA', async () => {
      const otherStudent = await User.create({
        email: 'other@university.edu',
        hashedPassword: await hashPassword('TempPass1!'),
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });

      const { accessToken } = generateTokenPair(otherStudent.userId, 'student');

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'testuser',
          jira_token: 'jira_token_123',
          project_key: 'PROJ',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('JIRA Status (GET /groups/:groupId/jira)', () => {
    it('should return connected:true after successful JIRA setup', async () => {
      // Pre-setup group with JIRA config
      await Group.findOneAndUpdate(
        { groupId: group.groupId },
        {
          $set: {
            jiraUrl: 'https://jira.company.com',
            projectKey: 'PROJ',
            jiraProject: 'Test Project',
            jiraBoardUrl: 'https://jira.company.com/jira/software/projects/PROJ/boards',
          },
        }
      );

      const res = await request(app)
        .get(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.group_id).toBe(group.groupId);
      expect(res.body.jira_url).toBe('https://jira.company.com');
      expect(res.body.jira_project_key).toBe('PROJ');
      expect(res.body.validated).toBe(true);
    });

    it('should return connected:false before JIRA setup', async () => {
      const res = await request(app)
        .get(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.group_id).toBe(group.groupId);
      expect(res.body.jira_url).toBeNull();
      expect(res.body.validated).toBe(false);
    });

    it('should return 404 for non-existent group', async () => {
      const res = await request(app)
        .get(`/api/v1/groups/nonexistent-group/jira`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(res.status).toBe(404);
    });

    it('should return connected:false (error state) after failed setup attempt', async () => {
      // First attempt: invalid JIRA credentials (fails)
      axios.get.mockRejectedValueOnce({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const failRes = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.company.com',
          jira_username: 'invalid_user',
          jira_token: 'invalid_token',
          project_key: 'PROJ',
        });

      expect(failRes.status).toBe(422);

      // Second: GET should show connected:false (error state)
      const getRes = await request(app)
        .get(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.validated).toBe(false);
      expect(getRes.body.jira_url).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ──── NOTIFICATION SERVICE TESTS ──────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────────

  describe('Notification Service (POST /groups/:groupId/notifications)', () => {
    let invitee;

    beforeEach(async () => {
      // Create an invitee
      invitee = await User.create({
        email: 'invitee@university.edu',
        hashedPassword: await hashPassword('TempPass1!'),
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });

      // Create a pending invitation
      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: invitee.userId,
        invitedBy: leader.userId,
        status: 'pending',
      });
    });

    it('should successfully dispatch notification (200 response with notification_id)', async () => {
      // Mock the notification service response
      const notificationServicePath = require.resolve('../src/services/notificationService');
      delete require.cache[notificationServicePath];

      const mockNotificationService = {
        dispatchInvitationNotification: jest.fn().mockResolvedValueOnce({
          notification_id: 'notif_abc123',
          delivered_to: [invitee.email],
        }),
      };

      jest.doMock('../src/services/notificationService', () => mockNotificationService);

      // Re-require the controller with mocked notification service
      delete require.cache[require.resolve('../src/controllers/groupMembers')];
      jest.resetModules();
      jest.doMock('../src/services/notificationService', () => mockNotificationService);

      // Use axios mock instead for simpler approach
      axios.post = jest.fn().mockResolvedValueOnce({
        data: {
          notification_id: 'notif_abc123',
          delivered_to: [invitee.email],
        },
      });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('notification_id');
      expect(res.body).toHaveProperty('invitee_id', invitee.userId);
      expect(res.body).toHaveProperty('notified_at');
      expect(res.body).toHaveProperty('delivered_to');

      // Verify invitation was updated
      const updatedInvitation = await MemberInvitation.findOne({
        groupId: group.groupId,
        inviteeId: invitee.userId,
      });
      expect(updatedInvitation.notifiedAt).toBeDefined();
    });

    it('should return 400 when invitee_id is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_INVITEE_ID');
    });

    it('should return 404 when invitation not found', async () => {
      const otherStudent = await User.create({
        email: 'other@university.edu',
        hashedPassword: await hashPassword('TempPass1!'),
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: otherStudent.userId,
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVITATION_NOT_FOUND');
    });

    it('should return 403 when non-leader tries to dispatch notification', async () => {
      const otherStudent = await User.create({
        email: 'other@university.edu',
        hashedPassword: await hashPassword('TempPass1!'),
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });

      const { accessToken } = generateTokenPair(otherStudent.userId, 'student');

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should create SyncErrorLog after 3 notification service failures and return 503', async () => {
      // Simulate 3 consecutive notification service failures
      axios.post = jest.fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('NOTIFICATION_SERVICE_UNAVAILABLE');

      // Verify SyncErrorLog was created (error not silently swallowed)
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'notification',
      });
      expect(syncLogs.length).toBe(1);

      const log = syncLogs[0];
      expect(log.service).toBe('notification');
      expect(log.groupId).toBe(group.groupId);
      expect(log.actorId).toBe(leader.userId);
      expect(log.attempts).toBe(3);
      expect(log.lastError).toContain('Network timeout');
    });

    it('should retry notification dispatch on transient failures', async () => {
      // Mock axios to fail once then succeed
      axios.post = jest.fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          data: {
            notification_id: 'notif_retry_123',
            delivered_to: [invitee.email],
          },
        });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('notification_id');

      // Should NOT create SyncErrorLog (succeeded before max retries)
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'notification',
      });
      expect(syncLogs.length).toBe(0);
    });

    it('should log notification service 5xx errors and retry', async () => {
      // First 2 attempts fail (5xx), 3rd succeeds
      axios.post = jest.fn()
        .mockRejectedValueOnce({
          response: { status: 500, statusText: 'Internal Server Error' },
          message: 'Service error',
        })
        .mockRejectedValueOnce({
          response: { status: 503, statusText: 'Service Unavailable' },
          message: 'Service temporarily unavailable',
        })
        .mockResolvedValueOnce({
          data: {
            notification_id: 'notif_recovered_123',
            delivered_to: [invitee.email],
          },
        });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      expect(res.status).toBe(201);
      expect(res.body.notification_id).toBeDefined();

      // Should NOT create SyncErrorLog (succeeded on 3rd attempt)
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'notification',
      });
      expect(syncLogs.length).toBe(0);
    });

    it('should verify notification error is not silently swallowed when all retries fail', async () => {
      // All 3 attempts fail with different errors
      axios.post = jest.fn()
        .mockRejectedValueOnce(new Error('Connection reset'))
        .mockRejectedValueOnce(new Error('Request timeout'))
        .mockRejectedValueOnce(new Error('Service unavailable'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      // Error is NOT silently swallowed — returns 503
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('code', 'NOTIFICATION_SERVICE_UNAVAILABLE');

      // Error is logged in SyncErrorLog (not swallowed)
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'notification',
      });
      expect(syncLogs.length).toBe(1);
      expect(syncLogs[0].lastError).toContain('Service unavailable');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ──── SYNC ERROR LOG ASSERTIONS ───────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────────

  describe('SyncErrorLog Assertions', () => {
    it('should contain all required fields when external API fails', async () => {
      // Simulate GitHub API timeout × 3
      axios.get
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'));

      await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'github',
      });

      expect(syncLogs.length).toBe(1);

      const log = syncLogs[0];

      // Verify all required fields
      expect(log).toHaveProperty('service', 'github'); // api_type
      expect(log).toHaveProperty('groupId', group.groupId); // group_id
      expect(log).toHaveProperty('actorId', leader.userId); // actor
      expect(log).toHaveProperty('attempts', 3); // retry_count
      expect(log).toHaveProperty('lastError'); // last_error
      expect(log).toHaveProperty('createdAt'); // timestamp
      expect(log).toHaveProperty('updatedAt'); // timestamp
    });

    it('should not create SyncErrorLog for 4xx errors (no retry)', async () => {
      // Simulate 401 Unauthorized (4xx = no retry)
      axios.get.mockRejectedValueOnce({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_invalidtoken',
          org: 'test-org',
        });

      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'github',
      });

      expect(syncLogs.length).toBe(0);
    });

    it('should store the last error message correctly', async () => {
      const errorMsg = 'Connection refused on attempt 3';
      axios.get
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error(errorMsg));

      await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_validtoken123',
          org: 'test-org',
        });

      const syncLog = await SyncErrorLog.findOne({
        groupId: group.groupId,
        service: 'github',
      });

      expect(syncLog.lastError).toBeDefined();
      expect(syncLog.lastError).toContain('Connection refused');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ──── INTEGRATION TESTS: COMPLETE FLOWS ───────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────────

  describe('Integration: Complete GitHub Setup Flow (f10 → f11 → f12 → f24)', () => {
    it('should complete full GitHub configuration flow', async () => {
      const mockOrgData = {
        login: 'integration-org',
        id: 54321,
        name: 'Integration Test Organization',
      };

      axios.get
        .mockResolvedValueOnce({ data: { login: 'testuser', id: 999 } })
        .mockResolvedValueOnce({ data: mockOrgData });

      // f10: Leader submits GitHub PAT + org
      // f11-f12: Validate against GitHub API
      // f24: Store in D2
      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_integration_token',
          org: 'integration-org',
        });

      expect(res.status).toBe(201);
      expect(res.body.validated).toBe(true);

      // Verify f24: stored in D2
      const updatedGroup = await Group.findOne({ groupId: group.groupId });
      expect(updatedGroup.githubOrg).toBe('integration-org');
      expect(updatedGroup.githubPat).toBe('ghp_integration_token');

      // GET should now return connected: true
      const getRes = await request(app)
        .get(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.validated).toBe(true);
      expect(getRes.body.github_org).toBe('integration-org');
    });

    it('should handle GitHub setup failure with proper error recovery', async () => {
      // Simulate 3 consecutive failures
      axios.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_valid_token',
          org: 'test-org',
        });

      expect(res.status).toBe(503);

      // Verify sync error was logged
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'github',
      });
      expect(syncLogs.length).toBe(1);

      // GET should still return connected: false
      const getRes = await request(app)
        .get(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.validated).toBe(false);
    });
  });

  describe('Integration: Complete JIRA Setup Flow (f13 → f14 → f15 → f25)', () => {
    it('should complete full JIRA configuration flow', async () => {
      const mockProjectData = {
        id: 20000,
        key: 'INTEG',
        name: 'Integration Test Project',
      };

      axios.get
        .mockResolvedValueOnce({ data: { accountId: 'user123' } })
        .mockResolvedValueOnce({ data: mockProjectData });

      // f13: Leader submits JIRA credentials + project key
      // f14-f15: Validate against JIRA API
      // f25: Store in D2
      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.integration.com',
          jira_username: 'integrationuser',
          jira_token: 'integration_token_xyz',
          project_key: 'INTEG',
        });

      expect(res.status).toBe(201);
      expect(res.body.validated).toBe(true);

      // Verify f25: stored in D2
      const updatedGroup = await Group.findOne({ groupId: group.groupId });
      expect(updatedGroup.projectKey).toBe('INTEG');
      expect(updatedGroup.jiraUrl).toBe('https://jira.integration.com');

      // GET should now return connected: true
      const getRes = await request(app)
        .get(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.validated).toBe(true);
      expect(getRes.body.jira_project_key).toBe('INTEG');
    });

    it('should handle JIRA setup failure with proper error recovery', async () => {
      // Simulate 3 consecutive failures on project validation
      axios.get
        .mockResolvedValueOnce({ data: { accountId: 'user123' } }) // Credentials OK
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          jira_url: 'https://jira.integration.com',
          jira_username: 'integrationuser',
          jira_token: 'integration_token_xyz',
          project_key: 'INTEG',
        });

      expect(res.status).toBe(503);

      // Verify sync error was logged
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'jira',
      });
      expect(syncLogs.length).toBe(1);

      // GET should still return connected: false
      const getRes = await request(app)
        .get(`/api/v1/groups/${group.groupId}/jira`)
        .set('Authorization', `Bearer ${leaderToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.validated).toBe(false);
    });
  });

  describe('Integration: Complete Notification Flow with Error Handling', () => {
    let invitee;

    beforeEach(async () => {
      invitee = await User.create({
        email: 'notif-invitee@university.edu',
        hashedPassword: await hashPassword('TempPass1!'),
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        requiresPasswordChange: false,
      });

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: invitee.userId,
        invitedBy: leader.userId,
        status: 'pending',
      });
    });

    it('should successfully dispatch notification and record delivery', async () => {
      axios.post = jest.fn().mockResolvedValueOnce({
        data: {
          notification_id: 'notif_success_123',
          delivered_to: [invitee.email],
        },
      });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/notifications`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          invitee_id: invitee.userId,
        });

      expect(res.status).toBe(201);
      expect(res.body.notification_id).toBeDefined();
      expect(res.body).toHaveProperty('delivered_to');

      // Verify no sync error log was created
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'notification',
      });
      expect(syncLogs.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ──── RETRY LOGIC EDGE CASES ──────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────────

  describe('Retry Logic: Edge Cases', () => {
    it('should not retry on client errors (4xx)', async () => {
      // 400, 401, 403, 404, etc. should fail immediately without retry
      axios.get.mockRejectedValueOnce({
        response: { status: 403 },
        message: 'Forbidden',
      });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_token',
          org: 'test-org',
        });

      expect(res.status).toBe(422);

      // Verify only 1 call was made (no retries)
      expect(axios.get).toHaveBeenCalledTimes(1);

      // No sync error log (4xx errors don't need logging)
      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'github',
      });
      expect(syncLogs.length).toBe(0);
    });

    it('should retry on 5xx errors', async () => {
      const mockOrgData = {
        login: 'test-org',
        id: 12345,
        name: 'Test Organization',
      };

      // Simulate: 500 error on attempt 1, succeeds on attempt 2
      axios.get
        .mockRejectedValueOnce({
          response: { status: 500 },
          message: 'Internal Server Error',
        }) // Attempt 1: 5xx (transient)
        .mockResolvedValueOnce({ data: { login: 'testuser', id: 999 } }) // Attempt 2: success
        .mockResolvedValueOnce({ data: mockOrgData }); // Org data

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_token',
          org: 'test-org',
        });

      expect(res.status).toBe(201);
      expect(res.body.validated).toBe(true);

      // Verify retries happened (3 calls: retry on 5xx, then org data)
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('should succeed on 2nd timeout retry', async () => {
      const mockOrgData = {
        login: 'test-org',
        id: 12345,
        name: 'Test Organization',
      };

      // 1st attempt: timeout, 2nd: success
      axios.get
        .mockRejectedValueOnce(new Error('ECONNABORTED'))
        .mockResolvedValueOnce({ data: { login: 'testuser', id: 999 } })
        .mockResolvedValueOnce({ data: mockOrgData });

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_token',
          org: 'test-org',
        });

      expect(res.status).toBe(201);
    });

    it('should fail on 3rd timeout attempt', async () => {
      axios.get
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'));

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/github`)
        .set('Authorization', `Bearer ${leaderToken}`)
        .send({
          pat: 'ghp_token',
          org: 'test-org',
        });

      expect(res.status).toBe(503);

      const syncLogs = await SyncErrorLog.find({
        groupId: group.groupId,
        service: 'github',
      });
      expect(syncLogs.length).toBe(1);
    });
  });
});
