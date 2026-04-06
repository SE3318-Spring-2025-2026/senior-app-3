/**
 * Member Invitation Integration Tests
 *
 * Tests for groupMembers.js controller:
 *   addMember            (f05, f19) — leader invites student, writes D2 record
 *   dispatchNotification (f06)      — dispatch invitation via Notification Service
 *   membershipDecision   (f07, f08) — student accepts / rejects invitation
 *   getMembers                      — retrieve current member list from D2
 *
 * Run: npm test -- memberInvitation.test.js
 */

const mongoose = require('mongoose');

// Mock the Notification Service so tests never hit a real HTTP endpoint
jest.mock('../src/services/notificationService');

describe('groupMembers controller', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-member-invitation';

  let Group;
  let GroupMembership;
  let MemberInvitation;
  let SyncErrorLog;
  let User;
  let notificationService;
  let addMember;
  let getMembers;
  let dispatchNotification;
  let membershipDecision;

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

  const makeStudent = (overrides = {}) =>
    User.create({
      userId: `usr_stu_${Date.now()}_${Math.random()}`,
      email: `student_${Date.now()}_${Math.random()}@test.com`,
      hashedPassword: 'hashed',
      role: 'student',
      accountStatus: 'active',
      ...overrides,
    });

  // ── Setup / teardown ───────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    Group = require('../src/models/Group');
    GroupMembership = require('../src/models/GroupMembership');
    MemberInvitation = require('../src/models/MemberInvitation');
    SyncErrorLog = require('../src/models/SyncErrorLog');
    User = require('../src/models/User');
    notificationService = require('../src/services/notificationService');
    ({ addMember, getMembers, dispatchNotification, membershipDecision } =
      require('../src/controllers/groupMembers'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      Group.deleteMany({}),
      GroupMembership.deleteMany({}),
      MemberInvitation.deleteMany({}),
      SyncErrorLog.deleteMany({}),
      User.deleteMany({}),
    ]);
    jest.clearAllMocks();
  });

  // ── addMember (f05, f06, f19, f32) ───────────────────────────────────────────

  describe('POST /groups/:groupId/members — addMember (f05, f06, f19, f32)', () => {
    beforeEach(() => {
      // Default: notification service succeeds
      notificationService.dispatchInvitationNotification.mockResolvedValue({ notification_id: 'notif_test' });
    });

    it('returns 201 with added[], group_id, total_members for a single valid student', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      const req = makeReq({ groupId: group.groupId }, { student_ids: [student.userId] });
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.group_id).toBe(group.groupId);
      expect(body.total_members).toBeDefined();
      expect(Array.isArray(body.added)).toBe(true);
      expect(body.added).toHaveLength(1);
      expect(body.added[0].invitation_id).toMatch(/^inv_/);
      expect(body.added[0].invitee_id).toBe(student.userId);
      expect(body.added[0].status).toBe('pending');
    });

    it('returns 201 with added[] for multiple valid students', async () => {
      const group = await makeGroup();
      const s1 = await makeStudent();
      const s2 = await makeStudent();

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [s1.userId, s2.userId] }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.added).toHaveLength(2);
      expect(body.total_members).toBe(group.members.length + 2);
    });

    it('f32: reads current group data from D2 before processing', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        res
      );

      // total_members reflects group.members.length at time of request
      const body = res.json.mock.calls[0][0];
      expect(body.total_members).toBe(group.members.length + 1);
    });

    it('f19: writes a pending MemberInvitation record to D2', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        makeRes()
      );

      const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
      expect(inv).not.toBeNull();
      expect(inv.status).toBe('pending');
      expect(inv.invitedBy).toBe('usr_leader');
    });

    it('f19: also writes a pending GroupMembership record to D2', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        makeRes()
      );

      const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
      expect(mem).not.toBeNull();
      expect(mem.status).toBe('pending');
    });

    it('f06: dispatches invitation notification for each added student', async () => {
      const group = await makeGroup();
      const s1 = await makeStudent();
      const s2 = await makeStudent();

      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [s1.userId, s2.userId] }),
        makeRes()
      );

      expect(notificationService.dispatchInvitationNotification).toHaveBeenCalledTimes(2);
    });

    it('f06: marks added entry notified:true when dispatch succeeds', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        res
      );

      const body = res.json.mock.calls[0][0];
      expect(body.added[0].notified).toBe(true);
    });

    it('f06: still adds member and marks notified:false when notification service fails', async () => {
      notificationService.dispatchInvitationNotification.mockRejectedValue(new Error('service down'));
      const group = await makeGroup();
      const student = await makeStudent();

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.added).toHaveLength(1);
      expect(body.added[0].notified).toBe(false);
    });

    it('returns 400 MISSING_STUDENT_IDS when student_ids is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await addMember(makeReq({ groupId: group.groupId }, {}), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_STUDENT_IDS');
    });

    it('returns 400 MISSING_STUDENT_IDS when student_ids is an empty array', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await addMember(makeReq({ groupId: group.groupId }, { student_ids: [] }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_STUDENT_IDS');
    });

    it('returns 403 FORBIDDEN when caller is not the group leader', async () => {
      const group = await makeGroup({ leaderId: 'usr_other_leader' });
      const student = await makeStudent();
      const res = makeRes();

      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }, { userId: 'usr_leader' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const student = await makeStudent();
      const res = makeRes();

      await addMember(makeReq({ groupId: 'grp_nonexistent' }, { student_ids: [student.userId] }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('returns 201 with STUDENT_NOT_FOUND in errors[] when invitee does not exist', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await addMember(makeReq({ groupId: group.groupId }, { student_ids: ['usr_ghost'] }), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.added).toHaveLength(0);
      expect(body.errors[0].code).toBe('STUDENT_NOT_FOUND');
    });

    it('returns 201 with ALREADY_INVITED in errors[] when student was already invited', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        makeRes()
      );

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.added).toHaveLength(0);
      expect(body.errors[0].code).toBe('ALREADY_INVITED');
    });

    it('returns 201 with STUDENT_ALREADY_IN_GROUP in errors[] when student is approved elsewhere', async () => {
      const group = await makeGroup();
      const otherGroup = await makeGroup({ leaderId: 'usr_leader', groupName: `Other ${Date.now()}` });
      const student = await makeStudent();

      await GroupMembership.create({
        groupId: otherGroup.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.added).toHaveLength(0);
      expect(body.errors[0].code).toBe('STUDENT_ALREADY_IN_GROUP');
    });

    it('partial batch: adds valid students and collects errors for invalid ones', async () => {
      const group = await makeGroup();
      const validStudent = await makeStudent();

      const res = makeRes();
      await addMember(
        makeReq({ groupId: group.groupId }, { student_ids: [validStudent.userId, 'usr_ghost'] }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.added).toHaveLength(1);
      expect(body.added[0].invitee_id).toBe(validStudent.userId);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].code).toBe('STUDENT_NOT_FOUND');
    });
  });

  // ── getMembers ─────────────────────────────────────────────────────────────────

  describe('GET /groups/:groupId/members — getMembers', () => {
    it('returns 200 with group_id and members array', async () => {
      const group = await makeGroup();
      group.members.push({ userId: 'usr_m1', role: 'member', status: 'accepted', joinedAt: new Date() });
      await group.save();

      const res = makeRes();
      await getMembers(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.group_id).toBe(group.groupId);
      expect(body.members).toHaveLength(1);
      expect(body.members[0].userId).toBe('usr_m1');
    });

    it('returns 200 with empty members array when group has no members', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await getMembers(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].members).toHaveLength(0);
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await getMembers(makeReq({ groupId: 'grp_none' }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });
  });

  // ── dispatchNotification (f06) ─────────────────────────────────────────────────

  describe('POST /groups/:groupId/notifications — dispatchNotification (f06)', () => {
    it('returns 200 with notification_id and notified_at when service succeeds', async () => {
      notificationService.dispatchInvitationNotification.mockResolvedValue({
        notification_id: 'notif_abc123',
      });

      const group = await makeGroup();
      const student = await makeStudent();
      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: 'usr_leader',
      });

      const res = makeRes();
      await dispatchNotification(
        makeReq({ groupId: group.groupId }, { invitee_id: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.notification_id).toBe('notif_abc123');
      expect(body.invitee_id).toBe(student.userId);
      expect(body.notified_at).toBeDefined();
    });

    it('f06: sets invitation.notifiedAt and notificationId after successful dispatch', async () => {
      notificationService.dispatchInvitationNotification.mockResolvedValue({
        notification_id: 'notif_xyz',
      });

      const group = await makeGroup();
      const student = await makeStudent();
      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: 'usr_leader',
      });

      await dispatchNotification(
        makeReq({ groupId: group.groupId }, { invitee_id: student.userId }),
        makeRes()
      );

      const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
      expect(inv.notificationId).toBe('notif_xyz');
      expect(inv.notifiedAt).not.toBeNull();
    });

    it('returns 503 NOTIFICATION_SERVICE_UNAVAILABLE after 3 failures and writes SyncErrorLog', async () => {
      notificationService.dispatchInvitationNotification.mockRejectedValue(
        new Error('Connection timeout')
      );

      const group = await makeGroup();
      const student = await makeStudent();
      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: 'usr_leader',
      });

      const res = makeRes();
      await dispatchNotification(
        makeReq({ groupId: group.groupId }, { invitee_id: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0].code).toBe('NOTIFICATION_SERVICE_UNAVAILABLE');

      const errLog = await SyncErrorLog.findOne({ service: 'notification', groupId: group.groupId });
      expect(errLog).not.toBeNull();
      expect(errLog.attempts).toBe(3);
      expect(errLog.lastError).toBe('Connection timeout');
    });

    it('returns 400 MISSING_INVITEE_ID when invitee_id is absent', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await dispatchNotification(makeReq({ groupId: group.groupId }, {}), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_INVITEE_ID');
    });

    it('returns 403 FORBIDDEN when caller is not the group leader', async () => {
      const group = await makeGroup({ leaderId: 'usr_other' });
      const student = await makeStudent();
      const res = makeRes();

      await dispatchNotification(
        makeReq({ groupId: group.groupId }, { invitee_id: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await dispatchNotification(
        makeReq({ groupId: 'grp_none' }, { invitee_id: 'usr_x' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('returns 404 INVITATION_NOT_FOUND when no pending invitation exists', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await dispatchNotification(
        makeReq({ groupId: group.groupId }, { invitee_id: 'usr_no_invite' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('INVITATION_NOT_FOUND');
    });
  });

  // ── membershipDecision (f07, f08) ──────────────────────────────────────────────

  describe('POST /groups/:groupId/membership-decisions — membershipDecision (f07, f08)', () => {
    const setupInvitation = async (groupId, studentId) => {
      await MemberInvitation.create({ groupId, inviteeId: studentId, invitedBy: 'usr_leader' });
      await GroupMembership.create({ groupId, studentId, status: 'pending' });
    };

    it('returns 200 with invitation_id, group_id, student_id, decision, decided_at on accept', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      const res = makeRes();
      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.invitation_id).toMatch(/^inv_/);
      expect(body.group_id).toBe(group.groupId);
      expect(body.student_id).toBe(student.userId);
      expect(body.decision).toBe('accepted');
      expect(body.decided_at).toBeDefined();
    });

    it('f08: accepted decision updates MemberInvitation status to accepted', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        makeRes()
      );

      const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
      expect(inv.status).toBe('accepted');
      expect(inv.decidedAt).not.toBeNull();
    });

    it('f08: accepted decision updates GroupMembership status to approved', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        makeRes()
      );

      const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
      expect(mem.status).toBe('approved');
    });

    it('f08: accepted decision adds student to Group.members with role member and status accepted', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeDefined();
      expect(member.role).toBe('member');
      expect(member.status).toBe('accepted');
      expect(member.joinedAt).toBeDefined();
    });

    it('f08: rejected decision updates MemberInvitation status to rejected', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'rejected' }, { userId: student.userId }),
        makeRes()
      );

      const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
      expect(inv.status).toBe('rejected');
    });

    it('f08: rejected decision updates GroupMembership status to rejected', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'rejected' }, { userId: student.userId }),
        makeRes()
      );

      const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
      expect(mem.status).toBe('rejected');
    });

    it('f08: rejected decision does NOT add student to Group.members', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'rejected' }, { userId: student.userId }),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeUndefined();
    });

    it('returns 400 INVALID_DECISION when decision is missing', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      const res = makeRes();
      await membershipDecision(
        makeReq({ groupId: group.groupId }, {}, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_DECISION');
    });

    it('returns 400 INVALID_DECISION when decision value is unrecognized', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await setupInvitation(group.groupId, student.userId);

      const res = makeRes();
      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'maybe' }, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_DECISION');
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const student = await makeStudent();
      const res = makeRes();

      await membershipDecision(
        makeReq({ groupId: 'grp_none' }, { decision: 'accepted' }, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('returns 404 INVITATION_NOT_FOUND when no invitation exists for the student', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      const res = makeRes();

      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('INVITATION_NOT_FOUND');
    });

    it('returns 409 DECISION_ALREADY_MADE when invitation is no longer pending', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: 'usr_leader',
        status: 'accepted',
        decidedAt: new Date(),
      });

      const res = makeRes();
      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('DECISION_ALREADY_MADE');
    });

    it('f08: auto-denies and returns 409 STUDENT_ALREADY_IN_GROUP when student is approved elsewhere', async () => {
      const group = await makeGroup();
      const otherGroup = await makeGroup({ groupName: `Other ${Date.now()}`, leaderId: 'usr_leader' });
      const student = await makeStudent();

      // Student approved in another group
      await GroupMembership.create({ groupId: otherGroup.groupId, studentId: student.userId, status: 'approved' });

      await setupInvitation(group.groupId, student.userId);

      const res = makeRes();
      await membershipDecision(
        makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body.code).toBe('STUDENT_ALREADY_IN_GROUP');
      expect(body.auto_denied).toBe(true);

      // Invitation is auto-rejected in D2
      const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
      expect(inv.status).toBe('rejected');
    });
  });
});
