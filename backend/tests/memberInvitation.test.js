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
  let ScheduleWindow;
  let notificationService;
  let addMember;
  let getMembers;
  let dispatchNotification;
  let membershipDecision;
  let getApprovals;

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
    ScheduleWindow = require('../src/models/ScheduleWindow');
    notificationService = require('../src/services/notificationService');
    ({ addMember, getMembers, dispatchNotification, membershipDecision, getApprovals } =
      require('../src/controllers/groupMembers'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const openMemberAdditionWindow = (overrides = {}) => {
    const now = new Date();
    return ScheduleWindow.create({
      operationType: 'member_addition',
      startsAt: overrides.startsAt || new Date(now.getTime() - 60_000),
      endsAt: overrides.endsAt || new Date(now.getTime() + 60_000 * 60),
      isActive: true,
      createdBy: 'coordinator_1',
      ...overrides,
    });
  };

  beforeEach(async () => {
    await Promise.all([
      Group.deleteMany({}),
      GroupMembership.deleteMany({}),
      MemberInvitation.deleteMany({}),
      SyncErrorLog.deleteMany({}),
      User.deleteMany({}),
      ScheduleWindow.deleteMany({}),
    ]);
    jest.clearAllMocks();
  });

  // ── addMember (f05, f06, f19, f32) ───────────────────────────────────────────

  describe('POST /groups/:groupId/members — addMember (f05, f06, f19, f32)', () => {
    beforeEach(async () => {
      // Default: active member_addition window open
      await openMemberAdditionWindow();
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

    // ── schedule boundary enforcement ───────────────────────────────────────────

    describe('schedule boundary enforcement', () => {
      it('returns 403 OUTSIDE_SCHEDULE_WINDOW when no member_addition window exists', async () => {
        await ScheduleWindow.deleteMany({});
        const group = await makeGroup();
        const student = await makeStudent();

        const res = makeRes();
        await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
        expect(res.json.mock.calls[0][0].reason).toBe(
          'Operation not available outside the configured schedule window'
        );
      });

      it('returns 403 when member_addition window exists but has not started yet', async () => {
        await ScheduleWindow.deleteMany({});
        const future = new Date(Date.now() + 60_000 * 60);
        await ScheduleWindow.create({
          operationType: 'member_addition',
          startsAt: new Date(future.getTime()),
          endsAt: new Date(future.getTime() + 60_000 * 60),
          isActive: true,
          createdBy: 'coord_1',
        });

        const group = await makeGroup();
        const student = await makeStudent();
        const res = makeRes();
        await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
      });

      it('returns 403 when member_addition window has expired', async () => {
        await ScheduleWindow.deleteMany({});
        await ScheduleWindow.create({
          operationType: 'member_addition',
          startsAt: new Date(Date.now() - 60_000 * 120),
          endsAt: new Date(Date.now() - 60_000),
          isActive: true,
          createdBy: 'coord_1',
        });

        const group = await makeGroup();
        const student = await makeStudent();
        const res = makeRes();
        await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
      });

      it('returns 403 when member_addition window is deactivated (isActive: false)', async () => {
        await ScheduleWindow.deleteMany({});
        const now = new Date();
        await ScheduleWindow.create({
          operationType: 'member_addition',
          startsAt: new Date(now.getTime() - 60_000),
          endsAt: new Date(now.getTime() + 60_000 * 60),
          isActive: false,
          createdBy: 'coord_1',
        });

        const group = await makeGroup();
        const student = await makeStudent();
        const res = makeRes();
        await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
      });

      it('does not block when a group_creation window is open but no member_addition window exists', async () => {
        await ScheduleWindow.deleteMany({});
        const now = new Date();
        await ScheduleWindow.create({
          operationType: 'group_creation',
          startsAt: new Date(now.getTime() - 60_000),
          endsAt: new Date(now.getTime() + 60_000 * 60),
          isActive: true,
          createdBy: 'coord_1',
        });

        const group = await makeGroup();
        const student = await makeStudent();
        const res = makeRes();
        await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

        // Blocked because no member_addition window — group_creation window is irrelevant
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
      });

      it('allows member addition when an active member_addition window is open', async () => {
        // Window already created by outer beforeEach — just verify request succeeds
        const group = await makeGroup();
        const student = await makeStudent();
        const res = makeRes();

        await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

        expect(res.status).toHaveBeenCalledWith(201);
      });
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

    it('returns 200 with decision_id, group_id, student_id, decision, forwarded_to_notification, submitted_at on accept', async () => {
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
      expect(body.decision_id).toMatch(/^inv_/);
      expect(body.group_id).toBe(group.groupId);
      expect(body.student_id).toBe(student.userId);
      expect(body.decision).toBe('accepted');
      expect(typeof body.forwarded_to_notification).toBe('boolean');
      expect(body.submitted_at).toBeDefined();
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

    // ── membership_decision notification dispatch ─────────────────────────────

    describe('membership_decision notification dispatch', () => {
      beforeEach(() => {
        notificationService.dispatchMembershipDecisionNotification.mockResolvedValue({
          notification_id: 'notif_decision_test',
        });
      });

      it('dispatches membership_decision notification after accepted decision', async () => {
        const group = await makeGroup();
        const student = await makeStudent();
        await setupInvitation(group.groupId, student.userId);

        await membershipDecision(
          makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
          makeRes()
        );

        expect(notificationService.dispatchMembershipDecisionNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            groupId: group.groupId,
            groupName: group.groupName,
            studentId: student.userId,
            decision: 'accepted',
          })
        );
      });

      it('dispatches membership_decision notification after rejected decision', async () => {
        const group = await makeGroup();
        const student = await makeStudent();
        await setupInvitation(group.groupId, student.userId);

        await membershipDecision(
          makeReq({ groupId: group.groupId }, { decision: 'rejected' }, { userId: student.userId }),
          makeRes()
        );

        expect(notificationService.dispatchMembershipDecisionNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            groupId: group.groupId,
            decision: 'rejected',
          })
        );
      });

      it('sets forwarded_to_notification:true in response and stores notificationId on invitation after successful dispatch', async () => {
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
        expect(body.forwarded_to_notification).toBe(true);

        const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
        expect(inv.notificationId).toBe('notif_decision_test');
        expect(inv.notifiedAt).toBeDefined();
      });

      it('logs SyncErrorLog and still returns 200 when notification service fails after 3 retries', async () => {
        notificationService.dispatchMembershipDecisionNotification.mockRejectedValue(
          new Error('notification service down')
        );

        const group = await makeGroup();
        const student = await makeStudent();
        await setupInvitation(group.groupId, student.userId);

        const res = makeRes();
        await membershipDecision(
          makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
          res
        );

        // Decision still succeeds
        expect(res.status).toHaveBeenCalledWith(200);

        // Notification was retried 3 times
        expect(notificationService.dispatchMembershipDecisionNotification).toHaveBeenCalledTimes(3);

        // Failure logged to SyncErrorLog
        const errorLog = await SyncErrorLog.findOne({ groupId: group.groupId, service: 'notification' });
        expect(errorLog).not.toBeNull();
        expect(errorLog.attempts).toBe(3);
        expect(errorLog.lastError).toBe('notification service down');
      });
    });
  });

  // ── getApprovals ──────────────────────────────────────────────────────────────

  describe('GET /groups/:groupId/approvals — getApprovals', () => {
    it('returns 200 with empty approvals and overall_status no_invitations when no invitations exist', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await getApprovals(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.group_id).toBe(group.groupId);
      expect(body.approvals).toHaveLength(0);
      expect(body.overall_status).toBe('no_invitations');
      expect(body.summary).toEqual({ total: 0, accepted: 0, rejected: 0, pending: 0 });
    });

    it('returns overall_status pending when at least one invitation is still pending', async () => {
      const group = await makeGroup();
      const s1 = await makeStudent();
      const s2 = await makeStudent();

      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s1.userId, invitedBy: 'usr_leader', status: 'pending' });
      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s2.userId, invitedBy: 'usr_leader', status: 'accepted' });

      const res = makeRes();
      await getApprovals(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.overall_status).toBe('pending');
      expect(body.summary.pending).toBe(1);
      expect(body.summary.accepted).toBe(1);
    });

    it('returns overall_status all_accepted when all invitations are accepted', async () => {
      const group = await makeGroup();
      const s1 = await makeStudent();
      const s2 = await makeStudent();

      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s1.userId, invitedBy: 'usr_leader', status: 'accepted' });
      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s2.userId, invitedBy: 'usr_leader', status: 'accepted' });

      const res = makeRes();
      await getApprovals(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].overall_status).toBe('all_accepted');
    });

    it('returns overall_status all_rejected when all invitations are rejected', async () => {
      const group = await makeGroup();
      const s1 = await makeStudent();

      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s1.userId, invitedBy: 'usr_leader', status: 'rejected' });

      const res = makeRes();
      await getApprovals(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].overall_status).toBe('all_rejected');
    });

    it('returns overall_status all_decided when mix of accepted and rejected with none pending', async () => {
      const group = await makeGroup();
      const s1 = await makeStudent();
      const s2 = await makeStudent();

      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s1.userId, invitedBy: 'usr_leader', status: 'accepted' });
      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s2.userId, invitedBy: 'usr_leader', status: 'rejected' });

      const res = makeRes();
      await getApprovals(makeReq({ groupId: group.groupId }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.overall_status).toBe('all_decided');
      expect(body.summary).toEqual({ total: 2, accepted: 1, rejected: 1, pending: 0 });
    });

    it('returns each approval with invitation_id, student_id, status, decided_at, notification_id', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      const decidedAt = new Date();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: 'usr_leader',
        status: 'accepted',
        decidedAt,
        notificationId: 'notif_abc',
      });

      const res = makeRes();
      await getApprovals(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.approvals).toHaveLength(1);
      const approval = body.approvals[0];
      expect(approval.invitation_id).toMatch(/^inv_/);
      expect(approval.student_id).toBe(student.userId);
      expect(approval.status).toBe('accepted');
      expect(approval.decided_at).toBeDefined();
      expect(approval.notification_id).toBe('notif_abc');
    });

    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const res = makeRes();

      await getApprovals(makeReq({ groupId: 'grp_nonexistent' }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('only returns invitations belonging to the requested group', async () => {
      const group = await makeGroup();
      const otherGroup = await makeGroup({ groupName: `Other ${Date.now()}`, leaderId: 'usr_leader' });
      const s1 = await makeStudent();
      const s2 = await makeStudent();

      await MemberInvitation.create({ groupId: group.groupId, inviteeId: s1.userId, invitedBy: 'usr_leader', status: 'pending' });
      await MemberInvitation.create({ groupId: otherGroup.groupId, inviteeId: s2.userId, invitedBy: 'usr_leader', status: 'accepted' });

      const res = makeRes();
      await getApprovals(makeReq({ groupId: group.groupId }), res);

      const body = res.json.mock.calls[0][0];
      expect(body.approvals).toHaveLength(1);
      expect(body.approvals[0].student_id).toBe(s1.userId);
    });
  });
});
