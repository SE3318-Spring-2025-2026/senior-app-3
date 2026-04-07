/**
 * Group Creation Integration Tests
 *
 * Tests for createGroup controller (DFD flows f01, f02, f18, f03).
 * Covers: happy path, schedule window enforcement, duplicate name,
 *         leader validation, missing fields, github/jira fields.
 *
 * Run: npm test -- groupCreation.test.js
 */

const mongoose = require('mongoose');

// Mock Notification Service so tests never hit a real HTTP endpoint
jest.mock('../src/services/notificationService');

describe('POST /groups — createGroup', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-group-creation';

  let Group;
  let User;
  let ScheduleWindow;
  let SyncErrorLog;
  let notificationService;
  let createGroup;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const makeReq = (body = {}, userId = 'usr_leader') => ({
    body,
    user: { userId, role: 'student' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createActiveUser = (overrides = {}) =>
    User.create({
      email: `user_${Date.now()}_${Math.random()}@test.com`,
      hashedPassword: 'hashed',
      userId: overrides.userId || `usr_${Date.now()}`,
      accountStatus: 'active',
      role: 'student',
      ...overrides,
    });

  const openWindow = (overrides = {}) => {
    const now = new Date();
    return ScheduleWindow.create({
      operationType: 'group_creation',
      startsAt: overrides.startsAt || new Date(now.getTime() - 60_000),
      endsAt: overrides.endsAt || new Date(now.getTime() + 60_000 * 60),
      isActive: true,
      createdBy: 'coordinator_1',
      ...overrides,
    });
  };

  // ── Setup / teardown ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    Group = require('../src/models/Group');
    User = require('../src/models/User');
    ScheduleWindow = require('../src/models/ScheduleWindow');
    SyncErrorLog = require('../src/models/SyncErrorLog');
    notificationService = require('../src/services/notificationService');
    ({ createGroup } = require('../src/controllers/groups'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      Group.deleteMany({}),
      User.deleteMany({}),
      ScheduleWindow.deleteMany({}),
      SyncErrorLog.deleteMany({}),
    ]);
    jest.clearAllMocks();
    notificationService.dispatchGroupCreationNotification.mockResolvedValue({
      notification_id: 'notif_group_test',
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('returns 201 with group_id, status pending_validation, created_at', async () => {
      const leader = await createActiveUser({ userId: 'usr_leader1' });
      await openWindow();

      const req = makeReq({ groupName: 'Alpha Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.groupId).toMatch(/^grp_/);
      expect(body.status).toBe('pending_validation');
      expect(body.createdAt).toBeDefined();
    });

    it('auto-assigns requesting user as Team Leader in members list', async () => {
      const leader = await createActiveUser({ userId: 'usr_leader2' });
      await openWindow();

      const req = makeReq({ groupName: 'Beta Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      const body = res.json.mock.calls[0][0];
      const leaderMember = body.members.find((m) => m.userId === leader.userId);
      expect(leaderMember).toBeDefined();
      expect(leaderMember.role).toBe('leader');
      expect(leaderMember.status).toBe('accepted');
    });

    it('persists leaderId on the group document (f18)', async () => {
      const leader = await createActiveUser({ userId: 'usr_leader3' });
      await openWindow();

      const req = makeReq({ groupName: 'Gamma Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      const body = res.json.mock.calls[0][0];
      const saved = await Group.findOne({ groupId: body.groupId });
      expect(saved.leaderId).toBe(leader.userId);
    });

    it('stores optional github and jira fields when provided', async () => {
      const leader = await createActiveUser({ userId: 'usr_leader4' });
      await openWindow();

      const req = makeReq(
        {
          groupName: 'Delta Team',
          leaderId: leader.userId,
          githubPat: 'ghp_abc123',
          githubOrg: 'my-org',
          jiraUrl: 'https://myteam.atlassian.net',
          jiraUsername: 'user@test.com',
          jiraToken: 'jira_token',
          projectKey: 'DELTA',
        },
        leader.userId
      );
      const res = makeRes();

      await createGroup(req, res);

      const body = res.json.mock.calls[0][0];
      const saved = await Group.findOne({ groupId: body.groupId });
      expect(saved.githubPat).toBe('ghp_abc123');
      expect(saved.githubOrg).toBe('my-org');
      expect(saved.jiraUrl).toBe('https://myteam.atlassian.net');
      expect(saved.projectKey).toBe('DELTA');
    });

    it('stores group with null integration fields when not provided', async () => {
      const leader = await createActiveUser({ userId: 'usr_leader5' });
      await openWindow();

      const req = makeReq({ groupName: 'Epsilon Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      const body = res.json.mock.calls[0][0];
      const saved = await Group.findOne({ groupId: body.groupId });
      expect(saved.githubPat).toBeNull();
      expect(saved.githubOrg).toBeNull();
      expect(saved.jiraUrl).toBeNull();
    });
  });

  // ── Schedule window enforcement ───────────────────────────────────────────────

  describe('schedule boundary enforcement', () => {
    it('returns 403 OUTSIDE_SCHEDULE_WINDOW when no window exists', async () => {
      const leader = await createActiveUser({ userId: 'usr_nosched' });

      const req = makeReq({ groupName: 'No Window Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('returns 403 when window exists but is in the future', async () => {
      const leader = await createActiveUser({ userId: 'usr_futuresched' });
      const future = new Date(Date.now() + 60_000 * 60);
      await ScheduleWindow.create({
        operationType: 'group_creation',
        startsAt: new Date(future.getTime()),
        endsAt: new Date(future.getTime() + 60_000 * 60),
        isActive: true,
        createdBy: 'coord_1',
      });

      const req = makeReq({ groupName: 'Future Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('returns 403 when window has expired', async () => {
      const leader = await createActiveUser({ userId: 'usr_expiredsched' });
      await ScheduleWindow.create({
        operationType: 'group_creation',
        startsAt: new Date(Date.now() - 60_000 * 120),
        endsAt: new Date(Date.now() - 60_000),
        isActive: true,
        createdBy: 'coord_1',
      });

      const req = makeReq({ groupName: 'Expired Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('returns 403 when window is deactivated (isActive: false)', async () => {
      const leader = await createActiveUser({ userId: 'usr_inactivesched' });
      const now = new Date();
      await ScheduleWindow.create({
        operationType: 'group_creation',
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60_000 * 60),
        isActive: false,
        createdBy: 'coord_1',
      });

      const req = makeReq({ groupName: 'Inactive Window Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('allows creation when an active window is open', async () => {
      const leader = await createActiveUser({ userId: 'usr_opensched' });
      await openWindow();

      const req = makeReq({ groupName: 'Open Window Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ── Duplicate name ────────────────────────────────────────────────────────────

  describe('duplicate group name', () => {
    it('returns 409 GROUP_NAME_TAKEN when name already exists', async () => {
      const leader = await createActiveUser({ userId: 'usr_dup1' });
      await openWindow();
      await Group.create({ groupName: 'Taken Name', leaderId: leader.userId });

      const req = makeReq({ groupName: 'Taken Name', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
    });

    it('name check is case-insensitive', async () => {
      const leader = await createActiveUser({ userId: 'usr_dup2' });
      await openWindow();
      await Group.create({ groupName: 'Case Team', leaderId: leader.userId });

      const req = makeReq({ groupName: 'CASE TEAM', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('returns 400 when groupName is empty', async () => {
      await openWindow();
      const req = makeReq({ groupName: '', leaderId: 'usr_x' }, 'usr_x');
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_INPUT');
    });

    it('returns 400 when groupName is missing', async () => {
      await openWindow();
      const req = makeReq({ leaderId: 'usr_x' }, 'usr_x');
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_INPUT');
    });

    it('returns 400 when leaderId is missing', async () => {
      await openWindow();
      const req = makeReq({ groupName: 'Some Team' }, 'usr_x');
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_INPUT');
    });

    it('returns 403 when leaderId does not match authenticated user', async () => {
      await openWindow();
      const req = makeReq({ groupName: 'Mismatch Team', leaderId: 'usr_other' }, 'usr_actual');
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
    });

    it('returns 400 LEADER_NOT_FOUND when leaderId does not exist in D1', async () => {
      await openWindow();
      const req = makeReq({ groupName: 'Ghost Leader Team', leaderId: 'usr_ghost' }, 'usr_ghost');
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('LEADER_NOT_FOUND');
    });

    it('returns 400 LEADER_ACCOUNT_INACTIVE when leader account is not active', async () => {
      const leader = await createActiveUser({ userId: 'usr_inactive', accountStatus: 'pending' });
      await openWindow();

      const req = makeReq({ groupName: 'Inactive Leader Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('LEADER_ACCOUNT_INACTIVE');
    });
  });

  // ── f02: forwarding to process 2.2 ───────────────────────────────────────────

  describe('f02: groupName + leaderId forwarded to process 2.2', () => {
    it('persisted group document contains groupName and leaderId (D2 write)', async () => {
      const leader = await createActiveUser({ userId: 'usr_f02' });
      await openWindow();

      const req = makeReq({ groupName: 'F02 Team', leaderId: leader.userId }, leader.userId);
      const res = makeRes();

      await createGroup(req, res);

      const body = res.json.mock.calls[0][0];
      const saved = await Group.findOne({ groupId: body.groupId });
      expect(saved.groupName).toBe('F02 Team');
      expect(saved.leaderId).toBe(leader.userId);
    });
  });

  // ── general (group creation) notification dispatch ────────────────────────

  describe('general notification dispatch on group creation', () => {
    it('dispatches GROUP_CREATED notification after successful group creation', async () => {
      const leader = await createActiveUser({ userId: 'usr_notif1' });
      await openWindow();

      await createGroup(makeReq({ groupName: 'Notif Team', leaderId: leader.userId }, leader.userId), makeRes());

      expect(notificationService.dispatchGroupCreationNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: 'Notif Team',
          leaderId: leader.userId,
        })
      );
      expect(notificationService.dispatchGroupCreationNotification.mock.calls[0][0].groupId).toMatch(/^grp_/);
    });

    it('logs SyncErrorLog and still returns 201 when notification service fails after 3 retries', async () => {
      notificationService.dispatchGroupCreationNotification.mockRejectedValue(
        new Error('notification service unavailable')
      );

      const leader = await createActiveUser({ userId: 'usr_notif2' });
      await openWindow();

      const res = makeRes();
      await createGroup(makeReq({ groupName: 'Retry Team', leaderId: leader.userId }, leader.userId), res);

      // Group creation still succeeds
      expect(res.status).toHaveBeenCalledWith(201);

      // Notification was retried 3 times
      expect(notificationService.dispatchGroupCreationNotification).toHaveBeenCalledTimes(3);

      // Failure logged to SyncErrorLog
      const body = res.json.mock.calls[0][0];
      const errorLog = await SyncErrorLog.findOne({ groupId: body.groupId, service: 'notification' });
      expect(errorLog).not.toBeNull();
      expect(errorLog.attempts).toBe(3);
      expect(errorLog.lastError).toBe('notification service unavailable');
    });

    it('does not dispatch notification when group creation fails (outside window)', async () => {
      const leader = await createActiveUser({ userId: 'usr_notif3' });
      // No schedule window

      await createGroup(makeReq({ groupName: 'No Window Team', leaderId: leader.userId }, leader.userId), makeRes());

      expect(notificationService.dispatchGroupCreationNotification).not.toHaveBeenCalled();
    });
  });
});
