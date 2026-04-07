/**
 * Comprehensive Group CRUD, Member Management & Override Endpoints Tests
 * Issue #55: BE Test - Group CRUD, Member Management & Override Endpoints
 *
 * Tests all group-related endpoints:
 * - POST /groups (create)
 * - GET /groups/:groupId (retrieve)
 * - POST /groups/:groupId/members (add member)
 * - GET /groups/:groupId/members (list members)
 * - POST /groups/:groupId/membership-decisions (accept/reject)
 * - POST /groups/:groupId/approval-results (forward results)
 * - PATCH /groups/:groupId/override (coordinator override)
 *
 * Coverage:
 * - Group name uniqueness, leader ID validation
 * - Schedule window enforcement
 * - Member role-based access control
 * - Membership decision auto-denial
 * - Coordinator override (add, remove, update)
 * - Audit logging for all write operations
 * - Group status lifecycle
 * - Error handling and validation
 *
 * Run: npm test -- group-crud-member-management-comprehensive.test.js
 */

const mongoose = require('mongoose');

jest.mock('../src/services/notificationService', () => ({
  dispatchInvitationNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_001' }),
}));

describe('Group CRUD, Member Management & Override Endpoints — Issue #55', () => {
  const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/senior-app-test-group-comprehensive';

  let Group;
  let GroupMembership;
  let MemberInvitation;
  let User;
  let ScheduleWindow;
  let AuditLog;
  let Override;
  let ApprovalQueue;
  let createGroup;
  let getGroup;
  let forwardApprovalResults;
  let coordinatorOverride;
  let addMember;
  let getMembers;
  let membershipDecision;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
    params,
    body,
    user: { userId: 'usr_test', role: 'student', ...userOverrides },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  });

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createUser = (overrides = {}) =>
    User.create({
      userId: `usr_${Date.now()}_${Math.random()}`,
      email: `user_${Date.now()}_${Math.random()}@test.com`,
      hashedPassword: 'hashed',
      accountStatus: 'active',
      role: 'student',
      ...overrides,
    });

  const createActiveScheduleWindow = (overrides = {}) => {
    const now = new Date();
    return ScheduleWindow.create({
      startsAt: new Date(now.getTime() - 60000),
      endsAt: new Date(now.getTime() + 7200000), // 2 hours later
      isActive: true,
      createdBy: 'coordinator_1',
      ...overrides,
    });
  };

  const makeGroup = (overrides = {}) =>
    Group.create({
      groupName: `Test Group ${Date.now()}_${Math.random()}`,
      leaderId: 'usr_test',
      status: 'pending_validation',
      ...overrides,
    });

  // ── Setup / teardown ────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    Group = require('../src/models/Group');
    User = require('../src/models/User');
    ScheduleWindow = require('../src/models/ScheduleWindow');
    GroupMembership = require('../src/models/GroupMembership');
    MemberInvitation = require('../src/models/MemberInvitation');
    AuditLog = require('../src/models/AuditLog');
    Override = require('../src/models/Override');
    ApprovalQueue = require('../src/models/ApprovalQueue');

    ({ createGroup, getGroup, forwardApprovalResults, coordinatorOverride } =
      require('../src/controllers/groups'));
    ({ addMember, getMembers, membershipDecision } = require('../src/controllers/groupMembers'));
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
      User.deleteMany({}),
      ScheduleWindow.deleteMany({}),
      AuditLog.deleteMany({}),
      Override.deleteMany({}),
      ApprovalQueue.deleteMany({}),
    ]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /groups — Create Group
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /groups — Create Group', () => {
    it('should return 201 with group_id and status: pending_validation for valid request', async () => {
      const leader = await createUser({ role: 'student' });
      await createActiveScheduleWindow();

      const req = makeReq({}, { groupName: 'Alpha Team', leaderId: leader.userId }, { userId: leader.userId });
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.groupId).toBeDefined();
      expect(body.status).toBe('pending_validation');
      expect(body.createdAt).toBeDefined();
    });

    it('should return 409 when group name already exists (duplicate name)', async () => {
      const leader = await createUser({ role: 'student' });
      await createActiveScheduleWindow();

      await Group.create({
        groupName: 'Existing Group',
        leaderId: leader.userId,
        status: 'pending_validation',
      });

      const req = makeReq(
        {},
        { groupName: 'Existing Group', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
    });

    it('should return 409 for duplicate name (case-insensitive)', async () => {
      const leader = await createUser({ role: 'student' });
      await createActiveScheduleWindow();

      await Group.create({
        groupName: 'Test Group',
        leaderId: leader.userId,
        status: 'pending_validation',
      });

      const req = makeReq(
        {},
        { groupName: 'test group', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
    });

    it('should return 403 when creating group outside schedule window', async () => {
      const leader = await createUser({ role: 'student' });
      // No active schedule window

      const req = makeReq(
        { groupName: 'Beta Team', leaderId: leader.userId },
        {},
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('should return 400 when groupName is missing', async () => {
      const leader = await createUser({ role: 'student' });
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_INPUT');
    });

    it('should return 400 when leaderId is missing', async () => {
      const leader = await createUser({ role: 'student' });
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { groupName: 'Gamma Team' },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_INPUT');
    });

    it('should return 400 when leaderId does not exist in user accounts (D1)', async () => {
      await createActiveScheduleWindow();

      // Use a nonexistent leaderId as both auth user and requested leaderId
      // This bypasses the "must match" check and tests the "user doesn't exist" check
      const req = makeReq(
        {},
        { groupName: 'Delta Team', leaderId: 'nonexistent_user' },
        { userId: 'nonexistent_user' }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('LEADER_NOT_FOUND');
    });

    it('should return 400 when leader account is not active', async () => {
      const leader = await createUser({ accountStatus: 'pending' });
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { groupName: 'Echo Team', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('LEADER_ACCOUNT_INACTIVE');
    });

    it('should create audit log entry with action GROUP_CREATED', async () => {
      const leader = await createUser({ role: 'student' });
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { groupName: 'Audit Test Group', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      const auditLog = await AuditLog.findOne({ action: 'GROUP_CREATED' });
      expect(auditLog).toBeDefined();
      expect(auditLog.actorId).toBe(leader.userId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /groups/:groupId — Retrieve Group
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /groups/:groupId — Retrieve Group', () => {
    it('should return 200 with group details for existing group', async () => {
      const group = await makeGroup();

      const req = makeReq({ groupId: group.groupId }, {}, { userId: group.leaderId });
      const res = makeRes();

      await getGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.groupId).toBe(group.groupId);
      expect(body.groupName).toBe(group.groupName);
      expect(body.leaderId).toBe(group.leaderId);
      expect(body.status).toBe('pending_validation');
    });

    it('should return 404 for non-existent group', async () => {
      const user = await createUser();

      const req = makeReq({ groupId: 'grp_unknown' }, {}, { userId: user.userId });
      const res = makeRes();

      await getGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('should return members array with correct roles', async () => {
      const member = await createUser();
      const group = await makeGroup();
      group.members = [{ userId: member.userId, role: 'member', status: 'accepted', joinedAt: new Date() }];
      await group.save();

      const req = makeReq({ groupId: group.groupId }, {}, { userId: group.leaderId });
      const res = makeRes();

      await getGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.members).toHaveLength(1);
      expect(body.members[0].role).toBe('member');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /groups/:groupId/members — Add Member
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /groups/:groupId/members — Add Member', () => {
    // Ensure an active schedule window exists for all tests
    beforeEach(async () => {
      await createActiveScheduleWindow();
    });

    it('should return 201 when leader invites valid student', async () => {
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.invitation_id).toBeDefined();
      expect(body.status).toBe('pending');
    });

    it('should return 400 when invitee_id is missing', async () => {
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {},
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_INVITEE_ID');
    });

    it('should return 404 when invitee_id is invalid (student not found)', async () => {
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: 'nonexistent_user' },
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('STUDENT_NOT_FOUND');
    });

    it('should return 403 when non-leader tries to add member', async () => {
      const group = await makeGroup();
      const nonLeader = await createUser();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: nonLeader.userId }
      );
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
    });

    it('should return 409 when student already belongs to another active group', async () => {
      const group1 = await makeGroup();
      const group2 = await makeGroup();
      const student = await createUser();

      // Student already approved in another group
      await GroupMembership.create({
        groupId: group2.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const req = makeReq(
        { groupId: group1.groupId },
        { invitee_id: student.userId },
        { userId: group1.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('STUDENT_ALREADY_IN_GROUP');
    });

    it('should create MemberInvitation and GroupMembership records', async () => {
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      const invitation = await MemberInvitation.findOne({
        groupId: group.groupId,
        inviteeId: student.userId,
      });
      expect(invitation).toBeDefined();
      expect(invitation.status).toBe('pending');

      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: student.userId,
      });
      expect(membership).toBeDefined();
      expect(membership.status).toBe('pending');
    });

    it('should return 403 when adding member outside schedule window', async () => {
      const group = await makeGroup();
      const student = await createUser();

      // Delete all schedule windows to ensure no active window
      await ScheduleWindow.deleteMany({});

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('should create audit log entry for member addition', async () => {
      const group = await makeGroup();
      const student = await createUser();
      await createActiveScheduleWindow();

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBER_ADDED' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /groups/:groupId/members — List Members
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /groups/:groupId/members — List Members', () => {
    it('should return 200 with members array', async () => {
      const member = await createUser();
      const group = await makeGroup();
      group.members = [{ userId: member.userId, role: 'member', status: 'accepted', joinedAt: new Date() }];
      await group.save();

      const req = makeReq({ groupId: group.groupId }, {}, { userId: group.leaderId });
      const res = makeRes();

      await getMembers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.group_id).toBe(group.groupId);
      expect(body.members).toHaveLength(1);
      expect(body.members[0].role).toBe('member');
      expect(body.members[0].status).toBe('accepted');
    });

    it('should return 200 with empty members array when no members', async () => {
      const group = await makeGroup();

      const req = makeReq({ groupId: group.groupId }, {}, { userId: group.leaderId });
      const res = makeRes();

      await getMembers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].members).toHaveLength(0);
    });

    it('should return 404 when group does not exist', async () => {
      const user = await createUser();

      const req = makeReq({ groupId: 'grp_unknown' }, {}, { userId: user.userId });
      const res = makeRes();

      await getMembers(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('should include role information for each member', async () => {
      const leader = await createUser();
      const group = await Group.create({
        groupName: `Group ${Date.now()}`,
        leaderId: leader.userId,
        status: 'active',
        members: [{ userId: leader.userId, role: 'leader', status: 'accepted', joinedAt: new Date() }],
      });

      const req = makeReq({ groupId: group.groupId }, {}, { userId: leader.userId });
      const res = makeRes();

      await getMembers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].members[0].role).toBe('leader');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /groups/:groupId/membership-decisions — Accept/Reject Membership
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /groups/:groupId/membership-decisions — Accept/Reject Membership', () => {
    it('should return 201 when student accepts membership', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.decision).toBe('accepted');
      expect(body.decided_at).toBeDefined();
    });

    it('should return 201 when student rejects membership', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'rejected' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.decision).toBe('rejected');
    });

    it('should return 404 when no invitation found', async () => {
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('INVITATION_NOT_FOUND');
    });

    it('should auto-deny and return 409 when student already in another approved group', async () => {
      const group1 = await makeGroup();
      const group2 = await makeGroup();
      const student = await createUser();

      // Student already approved in group2
      await GroupMembership.create({
        groupId: group2.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      // Invite to group1
      await MemberInvitation.create({
        groupId: group1.groupId,
        inviteeId: student.userId,
        invitedBy: group1.leaderId,
      });

      await GroupMembership.create({
        groupId: group1.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group1.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body.code).toBe('STUDENT_ALREADY_IN_GROUP');
      expect(body.auto_denied).toBe(true);
    });

    it('should update GroupMembership status to approved when accepted', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: student.userId,
      });
      expect(membership.status).toBe('approved');
    });

    it('should add student to group.members when accepted', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeDefined();
      expect(member.role).toBe('member');
      expect(member.status).toBe('accepted');
    });

    it('should auto-deny other pending invitations when student accepts one group', async () => {
      const group1 = await makeGroup();
      const group2 = await makeGroup();
      const group3 = await makeGroup();
      const student = await createUser();

      // Create pending invitations to multiple groups
      await MemberInvitation.create({
        groupId: group1.groupId,
        inviteeId: student.userId,
        invitedBy: group1.leaderId,
      });
      await GroupMembership.create({
        groupId: group1.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const inv2 = await MemberInvitation.create({
        groupId: group2.groupId,
        inviteeId: student.userId,
        invitedBy: group2.leaderId,
      });
      await GroupMembership.create({
        groupId: group2.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const inv3 = await MemberInvitation.create({
        groupId: group3.groupId,
        inviteeId: student.userId,
        invitedBy: group3.leaderId,
      });
      await GroupMembership.create({
        groupId: group3.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      // Accept invitation to group1
      const req = makeReq(
        { groupId: group1.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      // Verify other invitations are auto-denied
      const inv2Updated = await MemberInvitation.findOne({ invitationId: inv2.invitationId });
      expect(inv2Updated.status).toBe('rejected');

      const inv3Updated = await MemberInvitation.findOne({ invitationId: inv3.invitationId });
      expect(inv3Updated.status).toBe('rejected');

      // Verify corresponding GroupMembership records are updated
      const mem2 = await GroupMembership.findOne({
        groupId: group2.groupId,
        studentId: student.userId,
      });
      expect(mem2.status).toBe('rejected');

      const mem3 = await GroupMembership.findOne({
        groupId: group3.groupId,
        studentId: student.userId,
      });
      expect(mem3.status).toBe('rejected');
    });

    it('should return 409 when trying to decide on already decided invitation', async () => {
      const group = await makeGroup();
      const student = await createUser();

      const invitation = await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
        status: 'accepted',
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'rejected' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('DECISION_ALREADY_MADE');
    });

    it('should create audit log entry for membership decision', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBERSHIP_DECISION' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
      expect(log.details.decision).toBe('accepted');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /groups/:groupId/approval-results — Forward Approval Results
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /groups/:groupId/approval-results — Forward Approval Results', () => {
    it('should return 200 with forwarded_count for valid results', async () => {
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_001',
          results: [
            {
              student_id: 'stu_001',
              decision: 'approved',
              decided_by: 'cmember_1',
              decided_at: new Date().toISOString(),
            },
          ],
        },
        { userId: 'usr_committee', role: 'committee_member' }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.forwarded_count).toBe(1);
      expect(body.queued_request_ids).toBeDefined();
      expect(body.processed_at).toBeDefined();
    });

    it('should return 400 when results is empty', async () => {
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_001',
          results: [],
        },
        { userId: 'usr_committee', role: 'committee_member' }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('EMPTY_RESULTS');
    });

    it('should return 400 when notification_id is missing', async () => {
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {
          results: [
            {
              student_id: 'stu_001',
              decision: 'approved',
              decided_by: 'cmember_1',
              decided_at: new Date().toISOString(),
            },
          ],
        },
        { userId: 'usr_committee', role: 'committee_member' }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_NOTIFICATION_ID');
    });

    it('should be idempotent for duplicate notification_id', async () => {
      const group = await makeGroup();
      const notifId = 'notif_idempotent_001';

      const req1 = makeReq(
        { groupId: group.groupId },
        {
          notification_id: notifId,
          results: [
            {
              student_id: 'stu_001',
              decision: 'approved',
              decided_by: 'cmember_1',
              decided_at: new Date().toISOString(),
            },
          ],
        },
        { userId: 'usr_committee', role: 'committee_member' }
      );
      const res1 = makeRes();

      await forwardApprovalResults(req1, res1);

      const req2 = makeReq(
        { groupId: group.groupId },
        {
          notification_id: notifId,
          results: [
            {
              student_id: 'stu_001',
              decision: 'approved',
              decided_by: 'cmember_1',
              decided_at: new Date().toISOString(),
            },
          ],
        },
        { userId: 'usr_committee', role: 'committee_member' }
      );
      const res2 = makeRes();

      await forwardApprovalResults(req2, res2);

      expect(res1.status).toHaveBeenCalledWith(200);
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(res2.json.mock.calls[0][0].forwarded_count).toBe(0); // Should not forward again
    });

    it('should create GroupMembership records for approved decisions', async () => {
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_002',
          results: [
            {
              student_id: 'stu_002',
              decision: 'approved',
              decided_by: 'cmember_1',
              decided_at: new Date().toISOString(),
            },
          ],
        },
        { userId: 'usr_committee', role: 'committee_member' }
      );
      const res = makeRes();

      await forwardApprovalResults(req, res);

      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: 'stu_002',
      });
      expect(membership).toBeDefined();
      expect(membership.status).toBe('approved');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH /groups/:groupId/override — Coordinator Override
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PATCH /groups/:groupId/override — Coordinator Override', () => {
    it('should return 200 when coordinator adds a member', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Override for testing',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.override_id).toBeDefined();
      expect(body.action).toBe('add_member');
      expect(body.status).toBe('applied');
    });

    it('should return 200 when coordinator removes a member', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      group.members = [{ userId: student.userId, role: 'member', status: 'accepted', joinedAt: new Date() }];
      await group.save();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'remove_member',
          target_student_id: student.userId,
          reason: 'Member removal',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.action).toBe('remove_member');
    });

    it('should return 200 when coordinator updates group via update_group action', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'update_group',
          updates: { status: 'active' },
          reason: 'Coordinator approval',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.action).toBe('update_group');
    });

    it('should return 403 when non-coordinator tries to override', async () => {
      const user = await createUser({ role: 'student' });
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Test',
        },
        { userId: user.userId, role: 'student' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when group does not exist', async () => {
      const coordinator = await createUser({ role: 'coordinator' });

      const req = makeReq(
        { groupId: 'grp_unknown' },
        {
          action: 'add_member',
          target_student_id: 'usr_test',
          reason: 'Test',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('should return 400 when unknown field in update_group updates', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'update_group',
          updates: { unknownField: 'value', status: 'active' },
          reason: 'Test',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('UNKNOWN_FIELDS');
    });

    it('should update Group.members immediately when adding member (f21)', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Override',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeDefined();
      expect(member.status).toBe('accepted');
    });

    it('should update Group.members immediately when removing member (f21)', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      group.members = [{ userId: student.userId, role: 'member', status: 'accepted', joinedAt: new Date() }];
      await group.save();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'remove_member',
          target_student_id: student.userId,
          reason: 'Override',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeUndefined();
    });

    it('should create Override record with status reconciled', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Override test',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const override = await Override.findOne({
        groupId: group.groupId,
        action: 'add_member',
      });
      expect(override).toBeDefined();
      expect(override.status).toBe('reconciled');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT LOGGING TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Audit Logging for All Write Operations', () => {
    it('should create audit log for group creation', async () => {
      const leader = await createUser();
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { groupName: 'Audit Test Group', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      const log = await AuditLog.findOne({ action: 'GROUP_CREATED' });
      expect(log).toBeDefined();
      expect(log.actorId).toBe(leader.userId);
    });

    it('should create audit log when member is added to group', async () => {
      const group = await makeGroup();
      const leader = await createUser({ userId: group.leaderId });
      const student = await createUser();
      await createActiveScheduleWindow();

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: group.leaderId }
      );
      const res = makeRes();

      await addMember(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBER_ADDED' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
      expect(log.details.inviteeId).toBe(student.userId);
    });

    it('should create audit log for membership decision acceptance', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBERSHIP_DECISION' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
      expect(log.details.decision).toBe('accepted');
    });

    it('should create audit log for membership decision rejection', async () => {
      const group = await makeGroup();
      const student = await createUser();

      await MemberInvitation.create({
        groupId: group.groupId,
        inviteeId: student.userId,
        invitedBy: group.leaderId,
      });

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group.groupId },
        { decision: 'rejected' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBERSHIP_DECISION' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
      expect(log.details.decision).toBe('rejected');
    });

    it('should create audit log for auto-deny when student already in another group', async () => {
      const group1 = await makeGroup();
      const group2 = await makeGroup();
      const student = await createUser();

      // Student already approved in group2
      await GroupMembership.create({
        groupId: group2.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      // Invite to group1
      await MemberInvitation.create({
        groupId: group1.groupId,
        inviteeId: student.userId,
        invitedBy: group1.leaderId,
      });

      await GroupMembership.create({
        groupId: group1.groupId,
        studentId: student.userId,
        status: 'pending',
      });

      const req = makeReq(
        { groupId: group1.groupId },
        { decision: 'accepted' },
        { userId: student.userId }
      );
      const res = makeRes();

      await membershipDecision(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBERSHIP_DECISION_AUTO_DENIED' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group1.groupId);
    });

    it('should create audit log for coordinator override', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Override test',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const log = await AuditLog.findOne({ action: 'COORDINATOR_OVERRIDE' });
      expect(log).toBeDefined();
      expect(log.actorId).toBe(coordinator.userId);
      expect(log.targetId).toBe(group.groupId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP STATUS LIFECYCLE TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group Status Lifecycle', () => {
    it('should create group with status pending_validation', async () => {
      const group = await makeGroup();

      expect(group.status).toBe('pending_validation');
    });

    it('should transition status from pending_validation to active via override', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const leader = await createUser();

      const group = await Group.create({
        groupName: `Lifecycle Test ${Date.now()}`,
        leaderId: leader.userId,
        status: 'pending_validation',
      });

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'update_group',
          updates: { status: 'active' },
          reason: 'Coordinator approval',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const updated = await Group.findOne({ groupId: group.groupId });
      expect(updated.status).toBe('active');
    });

    it('should allow transition from active to inactive via override', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const leader = await createUser();

      const group = await Group.create({
        groupName: `Lifecycle Test 2 ${Date.now()}`,
        leaderId: leader.userId,
        status: 'active',
      });

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'update_group',
          updates: { status: 'inactive' },
          reason: 'Deactivation',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const updated = await Group.findOne({ groupId: group.groupId });
      expect(updated.status).toBe('inactive');
    });

    it('should return 409 when attempting invalid status transition', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const leader = await createUser();

      // Create active group (cannot go back to pending_validation)
      const group = await Group.create({
        groupName: `Invalid Transition Test ${Date.now()}`,
        leaderId: leader.userId,
        status: 'active',
      });

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'update_group',
          updates: { status: 'pending_validation' },
          reason: 'Invalid transition attempt',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should create STATUS_TRANSITION audit log when coordinator changes status', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const leader = await createUser();

      const group = await Group.create({
        groupName: `Status Transition Audit Test ${Date.now()}`,
        leaderId: leader.userId,
        status: 'pending_validation',
      });

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'update_group',
          updates: { status: 'active' },
          reason: 'Coordinator approval',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const log = await AuditLog.findOne({ action: 'STATUS_TRANSITION' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
      expect(log.details.previousStatus).toBe('pending_validation');
      expect(log.details.newStatus).toBe('active');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COORDINATOR OVERRIDE TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Coordinator Override Audit Logging', () => {
    it('should create MEMBER_REMOVED audit log when coordinator removes member', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      // Add student to group first
      group.members.push({
        userId: student.userId,
        role: 'member',
        status: 'accepted',
        joinedAt: new Date(),
      });
      await group.save();

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'remove_member',
          target_student_id: student.userId,
          reason: 'Contract violation',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      const log = await AuditLog.findOne({ action: 'MEMBER_REMOVED' });
      expect(log).toBeDefined();
      expect(log.targetId).toBe(group.groupId);
      expect(log.details.studentId).toBe(student.userId);
      expect(log.details.reason).toBe('Contract violation');
    });

    it('should create COORDINATOR_OVERRIDE log for member removal (in addition to MEMBER_REMOVED)', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      // Add student to group
      group.members.push({
        userId: student.userId,
        role: 'member',
        status: 'accepted',
        joinedAt: new Date(),
      });
      await group.save();

      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'approved',
      });

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'remove_member',
          target_student_id: student.userId,
          reason: 'Removal for audit test',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      // Both logs should exist
      const overrideLog = await AuditLog.findOne({ action: 'COORDINATOR_OVERRIDE' });
      const memberRemovedLog = await AuditLog.findOne({ action: 'MEMBER_REMOVED' });
      expect(overrideLog).toBeDefined();
      expect(memberRemovedLog).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULE WINDOW EXEMPTION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Schedule Window Exemption for Coordinators', () => {
    it('should allow coordinatorOverride to add member outside schedule window', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      // No active schedule window - coordinator should still succeed
      await ScheduleWindow.deleteMany({});

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Coordinator override bypass',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      // Should succeed with 200 (override endpoint returns 200)
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].status).toBe('applied');
    });

    it('should prevent leader from adding member outside schedule window', async () => {
      const leader = await createUser();
      const group = await makeGroup();
      group.leaderId = leader.userId;
      await group.save();
      const student = await createUser();

      // No active schedule window - leader should fail
      await ScheduleWindow.deleteMany({});

      const req = makeReq(
        { groupId: group.groupId },
        { invitee_id: student.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await addMember(req, res);

      // Leader should fail with 403 (outside schedule window)
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });

    it('should create MemberInvitation and GroupMembership when coordinator adds outside window', async () => {
      const coordinator = await createUser({ role: 'coordinator' });
      const group = await makeGroup();
      const student = await createUser();

      await ScheduleWindow.deleteMany({});

      const req = makeReq(
        { groupId: group.groupId },
        {
          action: 'add_member',
          target_student_id: student.userId,
          reason: 'Coordinator override',
        },
        { userId: coordinator.userId, role: 'coordinator' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      // Verify student was added to group
      const updatedGroup = await Group.findOne({ groupId: group.groupId });
      const member = updatedGroup.members.find((m) => m.userId === student.userId);
      expect(member).toBeDefined();
      expect(member.status).toBe('accepted');

      // Verify GroupMembership record exists
      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: student.userId,
      });
      expect(membership).toBeDefined();
      expect(membership.status).toBe('approved');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group Name Uniqueness Validation (Unit Test 2.2)', () => {
    it('should reject group creation with duplicate name (exact match)', async () => {
      const leader = await createUser();
      await createActiveScheduleWindow();

      const name = 'Unique Team Name';
      await Group.create({
        groupName: name,
        leaderId: leader.userId,
        status: 'pending_validation',
      });

      const req = makeReq(
        {},
        { groupName: name, leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
    });

    it('should reject group creation with duplicate name (case-insensitive)', async () => {
      const leader = await createUser();
      await createActiveScheduleWindow();

      const name = 'CaseSensitive Team';
      await Group.create({
        groupName: name,
        leaderId: leader.userId,
        status: 'pending_validation',
      });

      const req = makeReq(
        {},
        { groupName: 'casesensitive team', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
    });

    it('should allow group creation with different names', async () => {
      const leader = await createUser();
      await createActiveScheduleWindow();

      const req1 = makeReq(
        {},
        { groupName: 'Team A', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res1 = makeRes();

      await createGroup(req1, res1);

      expect(res1.status).toHaveBeenCalledWith(201);

      const leader2 = await createUser();
      await createActiveScheduleWindow();

      const req2 = makeReq(
        {},
        { groupName: 'Team B', leaderId: leader2.userId },
        { userId: leader2.userId }
      );
      const res2 = makeRes();

      await createGroup(req2, res2);

      expect(res2.status).toHaveBeenCalledWith(201);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LEADER ID VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Leader ID Validation (Unit Test 2.2)', () => {
    it('should reject when leaderId does not match authenticated user', async () => {
      const user1 = await createUser();
      const user2 = await createUser();
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { groupName: 'Test Group', leaderId: user2.userId },
        { userId: user1.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
    });

    it('should reject when leaderId does not exist (D1)', async () => {
      await createActiveScheduleWindow();

      // Use a nonexistent leaderId as both auth user and requested leaderId
      // This bypasses the "must match" check and tests the "user doesn't exist" check
      const req = makeReq(
        {},
        { groupName: 'Test Group', leaderId: 'nonexistent_leader' },
        { userId: 'nonexistent_leader' }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('LEADER_NOT_FOUND');
    });

    it('should accept when leaderId matches authenticated user and exists', async () => {
      const leader = await createUser();
      await createActiveScheduleWindow();

      const req = makeReq(
        {},
        { groupName: 'Valid Group', leaderId: leader.userId },
        { userId: leader.userId }
      );
      const res = makeRes();

      await createGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json.mock.calls[0][0].groupId).toBeDefined();
    });
  });
});
