/**
 * Audit Logging — Group Formation Events
 *
 * Verifies that every write-path action in Process 2.0 produces an audit log
 * entry with the required fields (event_type, actor_id, group_id, timestamp).
 *
 * Acceptance criteria covered:
 *  ✓ group_created          — POST /groups (createGroup controller)
 *  ✓ member_added           — POST /groups/:id/members (leader invitation)
 *  ✓ member_added           — PATCH /groups/:id/override (add_member)
 *  ✓ member_removed         — PATCH /groups/:id/override (remove_member)
 *  ✓ membership_decision    — POST /groups/:id/membership-decisions
 *  ✓ coordinator_override   — PATCH /groups/:id/override
 *  ✓ github_integration_setup — POST /groups/:id/github
 *  ✓ jira_integration_setup   — POST /groups/:id/jira
 *  ✓ sync_error             — recorded when external API calls fail after retries
 *  ✓ Append-only: no DELETE/PUT/PATCH on audit log entries via API
 *  ✓ Queryable by group_id and event_type via GET /api/v1/audit-logs
 *
 * Run: npm test -- audit-logging-group-events.test.js
 */

const mongoose = require('mongoose');
const axios = require('axios');
const request = require('supertest');
const app = require('../src/index');

jest.mock('axios');
jest.mock('../src/services/notificationService');

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-audit-group-events';

describe('Audit Logging — Group Formation Events', () => {
  // Models (populated in beforeAll)
  let AuditLog, Group, GroupMembership, MemberInvitation, User, ScheduleWindow, SyncErrorLog;

  // Controllers under test
  let createGroupCtrl, addMember, membershipDecision, coordinatorOverride;
  let configureGithub, configureJira;

  // ── Request / response factories ────────────────────────────────────────────

  const makeReq = (body = {}, params = {}, userOverrides = {}) => ({
    body,
    params,
    user: { userId: 'usr_default', role: 'student', ...userOverrides },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  // ── Setup / teardown ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoose.connect(MONGO_URI);
    await mongoose.connection.dropDatabase();

    AuditLog = require('../src/models/AuditLog');
    Group = require('../src/models/Group');
    GroupMembership = require('../src/models/GroupMembership');
    MemberInvitation = require('../src/models/MemberInvitation');
    User = require('../src/models/User');
    ScheduleWindow = require('../src/models/ScheduleWindow');
    SyncErrorLog = require('../src/models/SyncErrorLog');

    ({ createGroup: createGroupCtrl, coordinatorOverride } = require('../src/controllers/groups'));
    ({ addMember, membershipDecision } = require('../src/controllers/groupMembers'));
    ({ configureGithub, configureJira } = require('../src/controllers/groupIntegrations'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      AuditLog.deleteMany({}),
      Group.deleteMany({}),
      GroupMembership.deleteMany({}),
      MemberInvitation.deleteMany({}),
      User.deleteMany({}),
      ScheduleWindow.deleteMany({}),
      SyncErrorLog.deleteMany({}),
    ]);
    jest.clearAllMocks();
  });

  // ── Shared test helpers ───────────────────────────────────────────────────────

  const makeUser = (overrides = {}) =>
    User.create({
      userId: `usr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      email: `user_${Date.now()}_${Math.random().toString(36).slice(2)}@test.edu`,
      hashedPassword: 'hashed',
      role: 'student',
      accountStatus: 'active',
      ...overrides,
    });

  const makeGroup = (leaderId, overrides = {}) =>
    Group.create({
      groupName: `Group_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      leaderId,
      status: 'active',
      ...overrides,
    });

  const openWindow = (type = 'group_creation') => {
    const now = new Date();
    return ScheduleWindow.create({
      operationType: type,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
      isActive: true,
      createdBy: 'usr_coordinator',
    });
  };

  const assertAuditEntry = (log, { event_type, actor_id, group_id, payload = {} }) => {
    expect(log).not.toBeNull();
    expect(log.action).toBe(event_type);
    expect(log.actorId).toBe(actor_id);
    expect(log.groupId).toBe(group_id);
    expect(log.timestamp || log.createdAt).toBeTruthy();
    Object.entries(payload).forEach(([k, v]) => {
      expect(log.payload[k]).toEqual(v);
    });
  };

  // ── group_created ─────────────────────────────────────────────────────────────

  describe('group_created', () => {
    it('produces a group_created audit entry on successful group creation', async () => {
      await openWindow('group_creation');
      const leader = await makeUser({ userId: 'usr_leader_gc' });

      const req = makeReq(
        { groupName: 'Alpha Team', leaderId: leader.userId },
        {},
        { userId: leader.userId, role: 'student' }
      );

      await createGroupCtrl(req, makeRes());

      const log = await AuditLog.findOne({ action: 'group_created', actorId: leader.userId });
      assertAuditEntry(log, {
        event_type: 'group_created',
        actor_id: leader.userId,
        group_id: log.groupId,
        payload: { leader_id: leader.userId, group_name: 'Alpha Team' },
      });
    });
  });

  // ── member_added (leader invitation) ─────────────────────────────────────────

  describe('member_added (leader invitation)', () => {
    it('produces a member_added entry when leader invites a student', async () => {
      await openWindow('member_addition');
      const leader = await makeUser({ userId: 'usr_leader_ma' });
      const invitee = await makeUser({ userId: 'usr_invitee_ma' });
      const group = await makeGroup(leader.userId);

      const notifService = require('../src/services/notificationService');
      notifService.dispatchInvitationNotification = jest.fn().mockResolvedValue({
        notification_id: 'notif_001',
      });

      const req = makeReq(
        { student_ids: [invitee.userId] },
        { groupId: group.groupId },
        { userId: leader.userId, role: 'student' }
      );

      await addMember(req, makeRes());

      const log = await AuditLog.findOne({ action: 'member_added', groupId: group.groupId });
      assertAuditEntry(log, {
        event_type: 'member_added',
        actor_id: leader.userId,
        group_id: group.groupId,
        payload: { student_id: invitee.userId, via: 'leader_invitation' },
      });
    });
  });

  // ── membership_decision ───────────────────────────────────────────────────────

  describe('membership_decision', () => {
    const setupInvitation = async (leaderId, studentId) => {
      const group = await makeGroup(leaderId);
      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: studentId,
        invitedBy: leaderId,
        status: 'pending',
      });
      await GroupMembership.create({ groupId: group.groupId, studentId, status: 'pending' });
      return group;
    };

    beforeEach(() => {
      const notifService = require('../src/services/notificationService');
      notifService.dispatchMembershipDecisionNotification = jest.fn().mockResolvedValue({
        notification_id: 'notif_002',
      });
    });

    it('produces a membership_decision entry when student accepts', async () => {
      const leader = await makeUser({ userId: 'usr_leader_md_a' });
      const student = await makeUser({ userId: 'usr_student_md_a' });
      const group = await setupInvitation(leader.userId, student.userId);

      const req = makeReq(
        { decision: 'accepted' },
        { groupId: group.groupId },
        { userId: student.userId, role: 'student' }
      );
      await membershipDecision(req, makeRes());

      const log = await AuditLog.findOne({
        action: 'membership_decision',
        groupId: group.groupId,
        actorId: student.userId,
        'payload.decision': 'accepted',
      });
      assertAuditEntry(log, {
        event_type: 'membership_decision',
        actor_id: student.userId,
        group_id: group.groupId,
        payload: { decision: 'accepted', status: 'approved' },
      });
    });

    it('produces a membership_decision entry when student rejects', async () => {
      const leader = await makeUser({ userId: 'usr_leader_md_r' });
      const student = await makeUser({ userId: 'usr_student_md_r' });
      const group = await setupInvitation(leader.userId, student.userId);

      const req = makeReq(
        { decision: 'rejected' },
        { groupId: group.groupId },
        { userId: student.userId, role: 'student' }
      );
      await membershipDecision(req, makeRes());

      const log = await AuditLog.findOne({
        action: 'membership_decision',
        groupId: group.groupId,
        actorId: student.userId,
        'payload.decision': 'rejected',
      });
      assertAuditEntry(log, {
        event_type: 'membership_decision',
        actor_id: student.userId,
        group_id: group.groupId,
        payload: { decision: 'rejected', status: 'rejected' },
      });
    });
  });

  // ── coordinator_override ──────────────────────────────────────────────────────

  describe('coordinator_override', () => {
    it('produces coordinator_override + member_added entries for add_member', async () => {
      const student = await makeUser({ userId: 'usr_stu_co_add' });
      const group = await makeGroup('usr_leader_co_add');

      const req = makeReq(
        { action: 'add_member', target_student_id: student.userId, reason: 'Exception approval' },
        { groupId: group.groupId },
        { userId: 'usr_coord_add', role: 'coordinator' }
      );
      const res = makeRes();
      await coordinatorOverride(req, res);
      expect(res.status).toHaveBeenCalledWith(200);

      const overrideLog = await AuditLog.findOne({
        action: 'coordinator_override',
        groupId: group.groupId,
      });
      assertAuditEntry(overrideLog, {
        event_type: 'coordinator_override',
        actor_id: 'usr_coord_add',
        group_id: group.groupId,
        payload: { action: 'add_member', target_student_id: student.userId },
      });

      const addedLog = await AuditLog.findOne({
        action: 'member_added',
        groupId: group.groupId,
      });
      assertAuditEntry(addedLog, {
        event_type: 'member_added',
        actor_id: 'usr_coord_add',
        group_id: group.groupId,
        payload: { student_id: student.userId, via: 'coordinator_override' },
      });
    });

    it('produces coordinator_override + member_removed entries for remove_member', async () => {
      const student = await makeUser({ userId: 'usr_stu_co_rem' });
      const group = await makeGroup('usr_leader_co_rem', {
        members: [{ userId: student.userId, role: 'member', status: 'accepted' }],
      });
      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const req = makeReq(
        { action: 'remove_member', target_student_id: student.userId, reason: 'Policy violation' },
        { groupId: group.groupId },
        { userId: 'usr_coord_rem', role: 'coordinator' }
      );
      const res = makeRes();
      await coordinatorOverride(req, res);
      expect(res.status).toHaveBeenCalledWith(200);

      const removedLog = await AuditLog.findOne({
        action: 'member_removed',
        groupId: group.groupId,
      });
      assertAuditEntry(removedLog, {
        event_type: 'member_removed',
        actor_id: 'usr_coord_rem',
        group_id: group.groupId,
        payload: { student_id: student.userId, via: 'coordinator_override' },
      });

      const overrideLog = await AuditLog.findOne({
        action: 'coordinator_override',
        groupId: group.groupId,
        'payload.action': 'remove_member',
      });
      expect(overrideLog).not.toBeNull();
      expect(overrideLog.payload.target_student_id).toBe(student.userId);
      expect(overrideLog.payload.reason).toBe('Policy violation');
    });
  });

  // ── github_integration_setup ──────────────────────────────────────────────────

  describe('github_integration_setup', () => {
    it('produces a github_integration_setup entry on success', async () => {
      const group = await makeGroup('usr_leader_gh');

      axios.get
        .mockResolvedValueOnce({ status: 200, data: { login: 'usr_leader_gh' } })
        .mockResolvedValueOnce({ status: 200, data: { login: 'my-org', id: 42, name: 'My Org' } });

      const req = makeReq(
        { pat: 'ghp_validtoken', org: 'my-org' },
        { groupId: group.groupId },
        { userId: 'usr_leader_gh', role: 'student' }
      );
      const res = makeRes();
      await configureGithub(req, res);
      expect(res.status).toHaveBeenCalledWith(201);

      const log = await AuditLog.findOne({
        action: 'github_integration_setup',
        groupId: group.groupId,
      });
      assertAuditEntry(log, {
        event_type: 'github_integration_setup',
        actor_id: 'usr_leader_gh',
        group_id: group.groupId,
        payload: { status: 'success', org: 'my-org' },
      });
    });

    it('produces a sync_error entry when GitHub API is unavailable', async () => {
      const group = await makeGroup('usr_leader_gh2');
      axios.get.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const req = makeReq(
        { pat: 'ghp_token', org: 'my-org' },
        { groupId: group.groupId },
        { userId: 'usr_leader_gh2', role: 'student' }
      );
      const res = makeRes();
      await configureGithub(req, res);
      expect(res.status).toHaveBeenCalledWith(503);

      const log = await AuditLog.findOne({
        action: 'sync_error',
        groupId: group.groupId,
        'payload.api_type': 'github',
      });
      assertAuditEntry(log, {
        event_type: 'sync_error',
        actor_id: 'usr_leader_gh2',
        group_id: group.groupId,
        payload: { api_type: 'github', retry_count: 3 },
      });
      expect(log.payload.last_error).toBeTruthy();
      expect(log.payload.sync_error_id).toBeTruthy();
    });
  });

  // ── jira_integration_setup ────────────────────────────────────────────────────

  describe('jira_integration_setup', () => {
    it('produces a jira_integration_setup entry on success', async () => {
      const group = await makeGroup('usr_leader_jira');

      axios.get
        .mockResolvedValueOnce({ status: 200, data: { accountId: 'acc_123' } })
        .mockResolvedValueOnce({ status: 200, data: { key: 'PROJ', name: 'My Project' } });

      const req = makeReq(
        {
          jira_url: 'https://myorg.atlassian.net',
          jira_username: 'me@example.com',
          jira_token: 'token123',
          project_key: 'PROJ',
        },
        { groupId: group.groupId },
        { userId: 'usr_leader_jira', role: 'student' }
      );
      const res = makeRes();
      await configureJira(req, res);
      expect(res.status).toHaveBeenCalledWith(201);

      const log = await AuditLog.findOne({
        action: 'jira_integration_setup',
        groupId: group.groupId,
      });
      assertAuditEntry(log, {
        event_type: 'jira_integration_setup',
        actor_id: 'usr_leader_jira',
        group_id: group.groupId,
        payload: { status: 'success', project_key: 'PROJ' },
      });
    });

    it('produces a sync_error entry when JIRA API is unavailable', async () => {
      const group = await makeGroup('usr_leader_jira2');
      axios.get.mockRejectedValue(new Error('connect ETIMEDOUT'));

      const req = makeReq(
        {
          jira_url: 'https://myorg.atlassian.net',
          jira_username: 'me@example.com',
          jira_token: 'token123',
          project_key: 'PROJ',
        },
        { groupId: group.groupId },
        { userId: 'usr_leader_jira2', role: 'student' }
      );
      const res = makeRes();
      await configureJira(req, res);
      expect(res.status).toHaveBeenCalledWith(503);

      const log = await AuditLog.findOne({
        action: 'sync_error',
        groupId: group.groupId,
        'payload.api_type': 'jira',
      });
      assertAuditEntry(log, {
        event_type: 'sync_error',
        actor_id: 'usr_leader_jira2',
        group_id: group.groupId,
        payload: { api_type: 'jira', retry_count: 3 },
      });
      expect(log.payload.last_error).toBeTruthy();
      expect(log.payload.sync_error_id).toBeTruthy();
    });
  });

  // ── sync_error (notification service) ────────────────────────────────────────

  describe('sync_error (notification service)', () => {
    it('produces a sync_error entry when invitation notification fails after retries', async () => {
      await openWindow('member_addition');
      const leader = await makeUser({ userId: 'usr_leader_notif' });
      const invitee = await makeUser({ userId: 'usr_invitee_notif' });
      const group = await makeGroup(leader.userId);

      const notifService = require('../src/services/notificationService');
      notifService.dispatchInvitationNotification = jest
        .fn()
        .mockRejectedValue(new Error('Notification service down'));

      const req = makeReq(
        { student_ids: [invitee.userId] },
        { groupId: group.groupId },
        { userId: leader.userId, role: 'student' }
      );
      const res = makeRes();
      await addMember(req, res);
      // Main operation still succeeds
      expect(res.status).toHaveBeenCalledWith(201);

      const syncLog = await AuditLog.findOne({
        action: 'sync_error',
        groupId: group.groupId,
        'payload.api_type': 'notification',
      });
      expect(syncLog).not.toBeNull();
      expect(syncLog.actorId).toBe(leader.userId);
      expect(syncLog.payload.retry_count).toBe(3);
      expect(syncLog.payload.last_error).toBeTruthy();
      expect(syncLog.payload.sync_error_id).toBeTruthy();
    });
  });

  // ── Schema compliance ─────────────────────────────────────────────────────────

  describe('Schema compliance (event_type, actor_id, group_id, timestamp)', () => {
    it('every group event log includes all minimum required fields', async () => {
      const student = await makeUser({ userId: 'usr_stu_schema' });
      const group = await makeGroup('usr_leader_schema', {
        members: [{ userId: student.userId, role: 'member', status: 'accepted' }],
      });
      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const req = makeReq(
        { action: 'remove_member', target_student_id: student.userId, reason: 'Schema test' },
        { groupId: group.groupId },
        { userId: 'usr_coord_schema', role: 'coordinator' }
      );
      await coordinatorOverride(req, makeRes());

      const logs = await AuditLog.find({ groupId: group.groupId });
      expect(logs.length).toBeGreaterThan(0);

      for (const log of logs) {
        expect(log.action).toBeTruthy();                       // event_type
        expect(log.actorId).toBeTruthy();                      // actor_id
        expect(log.groupId).toBeTruthy();                      // group_id
        expect(log.timestamp || log.createdAt).toBeTruthy();   // timestamp
      }
    });
  });

  // ── Append-only & queryability ────────────────────────────────────────────────

  describe('Append-only guarantee and queryability', () => {
    let generateTokenPair;

    beforeAll(() => {
      ({ generateTokenPair } = require('../src/utils/jwt'));
    });

    it('GET /api/v1/audit-logs returns entries queryable by group_id', async () => {
      const coord = await makeUser({ userId: 'usr_coord_q1', role: 'coordinator' });
      const { accessToken } = generateTokenPair(coord.userId, 'coordinator');

      await AuditLog.create({
        action: 'group_created',
        actorId: coord.userId,
        groupId: 'grp_query_test_1',
        payload: { group_name: 'Query Group' },
        timestamp: new Date(),
      });

      const res = await request(app)
        .get('/api/v1/audit-logs?group_id=grp_query_test_1')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      const entry = res.body.entries[0];
      expect(entry.event_type).toBe('group_created');
      expect(entry.group_id).toBe('grp_query_test_1');
      expect(entry.event_id).toBeTruthy();
      expect(entry.timestamp).toBeTruthy();
    });

    it('GET /api/v1/audit-logs filters by event_type', async () => {
      const coord = await makeUser({ userId: 'usr_coord_q2', role: 'coordinator' });
      const { accessToken } = generateTokenPair(coord.userId, 'coordinator');

      await AuditLog.create([
        {
          action: 'github_integration_setup',
          actorId: coord.userId,
          groupId: 'grp_et_test',
          payload: { status: 'success' },
          timestamp: new Date(),
        },
        {
          action: 'jira_integration_setup',
          actorId: coord.userId,
          groupId: 'grp_et_test',
          payload: { status: 'success' },
          timestamp: new Date(),
        },
      ]);

      const res = await request(app)
        .get('/api/v1/audit-logs?group_id=grp_et_test&event_type=github_integration_setup')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.entries[0].event_type).toBe('github_integration_setup');
    });

    it('DELETE /api/v1/audit-logs/:id returns 404 — append-only, no delete endpoint exists', async () => {
      const coord = await makeUser({ userId: 'usr_coord_del', role: 'coordinator' });
      const { accessToken } = generateTokenPair(coord.userId, 'coordinator');

      const log = await AuditLog.create({
        action: 'group_created',
        actorId: coord.userId,
        groupId: 'grp_del_test',
        timestamp: new Date(),
      });

      const res = await request(app)
        .delete(`/api/v1/audit-logs/${log.auditId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect([404, 405, 403]).toContain(res.status);

      // Entry must still exist in the database
      const still = await AuditLog.findById(log._id);
      expect(still).not.toBeNull();
    });

    it('GET /api/v1/audit-logs returns 400 when no filter is provided', async () => {
      const coord = await makeUser({ userId: 'usr_coord_nf', role: 'coordinator' });
      const { accessToken } = generateTokenPair(coord.userId, 'coordinator');

      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_FILTER');
    });

    it('GET /api/v1/audit-logs returns 401 for unauthenticated requests', async () => {
      const res = await request(app).get('/api/v1/audit-logs?group_id=grp_any');
      expect(res.status).toBe(401);
    });
  });
});
