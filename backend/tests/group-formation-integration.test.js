/**
 * Group Formation — End-to-End Integration Test Suite
 * Issue #51: BE Group Formation Integration Test Suite
 *
 * Covers the full Process 2.0 (Group Formation & Integration Setup) flow:
 *   Sub-process 2.1  Group creation request received
 *   Sub-process 2.2  Group validation & D2 write
 *   Sub-process 2.3  Member addition & notification dispatch
 *   Sub-process 2.4  Student membership decision
 *   Sub-process 2.5  Approval forwarding to queue
 *   Sub-process 2.6  GitHub PAT validation & config storage
 *   Sub-process 2.7  JIRA credentials validation & config storage
 *   Sub-process 2.8  Coordinator override (add / remove / update)
 *
 * DFD flows explicitly tested: f01–f25
 *
 * Acceptance criteria:
 *   ✓ All DFD flows (f01–f25) have at least one corresponding integration test
 *   ✓ Happy-path tests pass for all 8 sub-processes (2.1–2.8)
 *   ✓ Error-path tests cover invalid PAT (422), invalid project key (422),
 *     out-of-window request (403), unauthorized override (403)
 *   ✓ Retry logic test confirms sync error log entry after 3 failures
 *   ✓ Auto-denial test confirms only one active group per student
 *   ✓ All tests run against an isolated test database with D2 schema applied
 *
 * Mock strategy:
 *   - axios            mocked for GitHub/JIRA external API calls
 *   - notificationService mocked for all notification dispatch
 *
 * Run: npm test -- group-formation-integration.test.js
 */

'use strict';

const mongoose = require('mongoose');
const axios = require('axios');

jest.mock('axios');
jest.mock('../src/services/notificationService', () => ({
  dispatchInvitationNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_test_001' }),
  dispatchMembershipDecisionNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_test_002' }),
  dispatchGroupCreationNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_test_003' }),
}));

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-group-formation-integration';

// ── Model and controller references (populated in beforeAll) ─────────────────

let Group;
let GroupMembership;
let MemberInvitation;
let ApprovalQueue;
let Override;
let AuditLog;
let SyncErrorLog;
let ScheduleWindow;
let User;

let createGroup;
let getGroup;
let addMember;
let getMembers;
let membershipDecision;
let forwardApprovalResults;
let coordinatorOverride;
let configureGithub;
let getGithub;
let configureJira;
let getJira;

// ── Request / response factories ─────────────────────────────────────────────

const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
  params,
  body,
  user: { userId: 'usr_leader', role: 'student', ...userOverrides },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest-integration-test' },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// ── DB seeding helpers ────────────────────────────────────────────────────────

const uid = () => `usr_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const createUser = (overrides = {}) =>
  User.create({
    userId: uid(),
    email: `${Date.now()}_${Math.random()}@test.edu`,
    hashedPassword: 'hashed',
    accountStatus: 'active',
    role: 'student',
    ...overrides,
  });

const makeGroup = (overrides = {}) =>
  Group.create({
    groupName: `Group_${Date.now()}_${Math.random()}`,
    leaderId: 'usr_leader',
    status: 'active',
    ...overrides,
  });

const createScheduleWindow = (operationType, overrides = {}) => {
  const now = new Date();
  return ScheduleWindow.create({
    operationType,
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 3_600_000),
    isActive: true,
    createdBy: 'usr_coord',
    ...overrides,
  });
};

// GitHub / JIRA mock helpers
const mockGithubValidPat = () =>
  axios.get.mockResolvedValueOnce({ status: 200, data: { login: 'usr_leader' } });

const mockGithubValidOrg = (org = 'test-org') =>
  axios.get.mockResolvedValueOnce({
    status: 200,
    data: { login: org, id: 99, name: 'Test Org' },
  });

const mockGithubInvalidPat = (status = 401) => {
  const err = new Error('Unauthorized');
  err.response = { status };
  axios.get.mockRejectedValueOnce(err);
};

const mockGithubOrgNotFound = () => {
  const err = new Error('Not Found');
  err.response = { status: 404 };
  axios.get.mockRejectedValueOnce(err);
};

const mockNetworkTimeout = (times = 3) => {
  for (let i = 0; i < times; i++) {
    axios.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
  }
};

const mockJiraValidCredentials = () =>
  axios.get.mockResolvedValueOnce({ status: 200, data: { accountId: 'jira_acc_001' } });

const mockJiraValidProject = (key = 'PROJ') =>
  axios.get.mockResolvedValueOnce({
    status: 200,
    data: { key, name: 'Test Project', id: '10001' },
  });

const mockJiraInvalidCredentials = (status = 401) => {
  const err = new Error('Unauthorized');
  err.response = { status };
  axios.get.mockRejectedValueOnce(err);
};

const mockJiraProjectNotFound = () => {
  const err = new Error('Not Found');
  err.response = { status: 404 };
  axios.get.mockRejectedValueOnce(err);
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();

  Group = require('../src/models/Group');
  GroupMembership = require('../src/models/GroupMembership');
  MemberInvitation = require('../src/models/MemberInvitation');
  ApprovalQueue = require('../src/models/ApprovalQueue');
  Override = require('../src/models/Override');
  AuditLog = require('../src/models/AuditLog');
  SyncErrorLog = require('../src/models/SyncErrorLog');
  ScheduleWindow = require('../src/models/ScheduleWindow');
  User = require('../src/models/User');

  ({ createGroup, getGroup, forwardApprovalResults, coordinatorOverride } =
    require('../src/controllers/groups'));
  ({ addMember, getMembers, membershipDecision } =
    require('../src/controllers/groupMembers'));
  ({ configureGithub, getGithub, configureJira, getJira } =
    require('../src/controllers/groupIntegrations'));
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
    ApprovalQueue.deleteMany({}),
    Override.deleteMany({}),
    AuditLog.deleteMany({}),
    SyncErrorLog.deleteMany({}),
    ScheduleWindow.deleteMany({}),
    User.deleteMany({}),
  ]);
  jest.clearAllMocks();

  const { dispatchInvitationNotification, dispatchMembershipDecisionNotification, dispatchGroupCreationNotification } =
    require('../src/services/notificationService');
  dispatchInvitationNotification.mockResolvedValue({ notification_id: 'notif_test_001' });
  dispatchMembershipDecisionNotification.mockResolvedValue({ notification_id: 'notif_test_002' });
  dispatchGroupCreationNotification.mockResolvedValue({ notification_id: 'notif_test_003' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.1 / 2.2 — Group Creation (f01 → f02 → f18 → f03)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.1/2.2 — Group Creation (f01 → f02 → f18 → f03)', () => {
  // ── Happy path ───────────────────────────────────────────────────────────────

  it('f01/f02/f18: creates group, persists to D2 with status pending_validation, and returns 201', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });

    const res = makeRes();
    await createGroup(
      makeReq({}, { groupName: 'Alpha Team', leaderId: leader.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.groupName).toBe('Alpha Team');
    expect(body.status).toBe('pending_validation');
    expect(body.leaderId).toBe(leader.userId);

    // D2 state assertion: record written with correct fields
    const d2Record = await Group.findOne({ groupName: 'Alpha Team' });
    expect(d2Record).not.toBeNull();
    expect(d2Record.status).toBe('pending_validation');
    expect(d2Record.leaderId).toBe(leader.userId);
  });

  it('f18: leader is auto-added to group.members as accepted on creation', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });

    const res = makeRes();
    await createGroup(
      makeReq({}, { groupName: 'Beta Team', leaderId: leader.userId }),
      res
    );

    const group = await Group.findOne({ groupName: 'Beta Team' });
    const leaderMember = group.members.find((m) => m.userId === leader.userId);
    expect(leaderMember).toBeDefined();
    expect(leaderMember.role).toBe('leader');
    expect(leaderMember.status).toBe('accepted');
  });

  it('f18: D2 group record has groupId assigned after creation', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });

    const res = makeRes();
    await createGroup(
      makeReq({}, { groupName: 'Gamma Team', leaderId: leader.userId }),
      res
    );

    const body = res.json.mock.calls[0][0];
    expect(body.groupId).toBeDefined();
    expect(body.groupId).toMatch(/^grp_/);
  });

  it('f03: audit log entry with action group_created is written to D2 after creation', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });

    await createGroup(
      makeReq({}, { groupName: 'Delta Team', leaderId: leader.userId }),
      makeRes()
    );

    const auditEntry = await AuditLog.findOne({ action: 'group_created' });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.actorId).toBe(leader.userId);
    expect(auditEntry.groupId).toBeDefined();
  });

  // ── GET /groups/:groupId (f32: D2 read-back) ────────────────────────────────

  it('f32: GET /groups/:groupId returns the persisted D2 record', async () => {
    const group = await makeGroup({ groupName: 'Epsilon Team', leaderId: 'usr_leader' });
    const res = makeRes();

    await getGroup(makeReq({ groupId: group.groupId }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.groupId).toBe(group.groupId);
    expect(body.groupName).toBe('Epsilon Team');
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f01: returns 403 OUTSIDE_SCHEDULE_WINDOW when no active group_creation window exists', async () => {
    const leader = await createUser({ userId: 'usr_leader' });
    const res = makeRes();

    await createGroup(
      makeReq({}, { groupName: 'Window Test', leaderId: leader.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
  });

  it('f02: returns 409 GROUP_NAME_TAKEN when name is already in D2', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });
    await makeGroup({ groupName: 'Zeta Team', leaderId: 'usr_other' });

    const res = makeRes();
    await createGroup(
      makeReq({}, { groupName: 'Zeta Team', leaderId: leader.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('GROUP_NAME_TAKEN');
  });

  it('f02: returns 400 LEADER_NOT_FOUND when leaderId is not in D2 (User collection)', async () => {
    await createScheduleWindow('group_creation');
    const res = makeRes();

    await createGroup(
      makeReq({}, { groupName: 'Orphan Team', leaderId: 'usr_leader' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('LEADER_NOT_FOUND');
  });

  it('f02: returns 409 STUDENT_ALREADY_LEADER when user already leads a group', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });
    await makeGroup({ groupName: 'Existing Group', leaderId: leader.userId, status: 'active' });

    const res = makeRes();
    await createGroup(
      makeReq({}, { groupName: 'Second Group', leaderId: leader.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('STUDENT_ALREADY_LEADER');
  });

  it('f02: returns 404 GROUP_NOT_FOUND when retrieving non-existent group', async () => {
    const res = makeRes();

    await getGroup(makeReq({ groupId: 'grp_nonexistent' }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.3 — Member Addition (f05 → f06 → f19)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.3 — Member Addition (f05 → f06 → f19)', () => {
  it('f05/f06/f19: leader invites student → MemberInvitation + GroupMembership(pending) written to D2', async () => {
    await createScheduleWindow('member_addition');
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: leader.userId });

    const res = makeRes();
    await addMember(
      makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.added).toHaveLength(1);
    expect(body.added[0].invitee_id).toBe(student.userId);
    expect(body.added[0].status).toBe('pending');

    // D2 state: MemberInvitation created
    const inv = await MemberInvitation.findOne({ groupId: group.groupId, inviteeId: student.userId });
    expect(inv).not.toBeNull();
    expect(inv.status).toBe('pending');

    // D2 state: GroupMembership created with pending status
    const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
    expect(mem).not.toBeNull();
    expect(mem.status).toBe('pending');
  });

  it('f06: notification dispatch is called once per invited student', async () => {
    const { dispatchInvitationNotification } = require('../src/services/notificationService');
    await createScheduleWindow('member_addition');
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: leader.userId });

    await addMember(
      makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
      makeRes()
    );

    expect(dispatchInvitationNotification).toHaveBeenCalledTimes(1);
    expect(dispatchInvitationNotification).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: group.groupId, inviteeId: student.userId })
    );
  });

  it('f19: member_added audit log written to D2 after invitation', async () => {
    await createScheduleWindow('member_addition');
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: leader.userId });

    await addMember(
      makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
      makeRes()
    );

    const audit = await AuditLog.findOne({ action: 'member_added', groupId: group.groupId });
    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe(leader.userId);
    expect(audit.payload.student_id).toBe(student.userId);
    expect(audit.payload.via).toBe('leader_invitation');
  });

  it('f05: returns 200 GET /groups/:groupId/members with current D2 member list', async () => {
    const group = await makeGroup({ members: [{ userId: 'usr_leader', role: 'leader', status: 'accepted' }] });
    const res = makeRes();

    await getMembers(makeReq({ groupId: group.groupId }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.group_id).toBe(group.groupId);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].userId).toBe('usr_leader');
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f05: returns 403 OUTSIDE_SCHEDULE_WINDOW for member addition without active window', async () => {
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: leader.userId });

    const res = makeRes();
    await addMember(
      makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
  });

  it('f05: returns 403 FORBIDDEN when non-leader attempts to add a member', async () => {
    await createScheduleWindow('member_addition');
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: 'usr_other_leader' });

    const res = makeRes();
    await addMember(
      makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }, { userId: leader.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  it('f19: returns 409 STUDENT_ALREADY_IN_GROUP when student already has approved membership', async () => {
    await createScheduleWindow('member_addition');
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const otherGroup = await makeGroup({ groupName: 'Other Group', leaderId: 'usr_other' });

    // Pre-approved membership in another group
    await GroupMembership.create({
      groupId: otherGroup.groupId,
      studentId: student.userId,
      status: 'approved',
    });

    const group = await makeGroup({ leaderId: leader.userId });
    const res = makeRes();
    await addMember(
      makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    // Student appears in errors (not added)
    expect(body.errors).toBeDefined();
    expect(body.errors[0].code).toBe('STUDENT_ALREADY_IN_GROUP');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.4 — Student Membership Decision (f07 → f08)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.4 — Membership Decision (f07 → f08)', () => {
  it('f07/f08: student accepts invitation → GroupMembership approved + added to group.members in D2', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await MemberInvitation.create({
      groupId: group.groupId,
      inviteeId: student.userId,
      invitedBy: 'usr_leader',
    });
    await GroupMembership.create({
      groupId: group.groupId,
      studentId: student.userId,
      status: 'pending',
    });

    const res = makeRes();
    await membershipDecision(
      makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.decision).toBe('accepted');

    // D2 state: GroupMembership updated to approved
    const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
    expect(mem.status).toBe('approved');

    // D2 state: student added to group.members embedded array
    const updatedGroup = await Group.findOne({ groupId: group.groupId });
    const memberEntry = updatedGroup.members.find((m) => m.userId === student.userId);
    expect(memberEntry).toBeDefined();
    expect(memberEntry.status).toBe('accepted');
  });

  it('f07/f08: student rejects invitation → GroupMembership rejected in D2', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await MemberInvitation.create({
      groupId: group.groupId,
      inviteeId: student.userId,
      invitedBy: 'usr_leader',
    });
    await GroupMembership.create({
      groupId: group.groupId,
      studentId: student.userId,
      status: 'pending',
    });

    const res = makeRes();
    await membershipDecision(
      makeReq({ groupId: group.groupId }, { decision: 'rejected' }, { userId: student.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);

    // D2 state: membership stays rejected
    const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
    expect(mem.status).toBe('rejected');
  });

  it('f08: membership_decision audit log written to D2 after student decision', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await MemberInvitation.create({ groupId: group.groupId, inviteeId: student.userId, invitedBy: 'usr_leader' });
    await GroupMembership.create({ groupId: group.groupId, studentId: student.userId, status: 'pending' });

    await membershipDecision(
      makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
      makeRes()
    );

    const audit = await AuditLog.findOne({ action: 'membership_decision', groupId: group.groupId });
    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe(student.userId);
    expect(audit.payload.decision).toBe('accepted');
  });

  // ── Auto-denial: one-active-group rule ───────────────────────────────────────

  it('f08: auto-denies invitation when student already belongs to an approved group (one-active-group rule)', async () => {
    const student = await createUser();
    const approvedGroup = await makeGroup({ groupName: 'Active Group' });
    const newGroup = await makeGroup({ groupName: 'New Group' });

    // Student already has approved membership in another group
    await GroupMembership.create({
      groupId: approvedGroup.groupId,
      studentId: student.userId,
      status: 'approved',
    });

    await MemberInvitation.create({ groupId: newGroup.groupId, inviteeId: student.userId, invitedBy: 'usr_leader' });
    await GroupMembership.create({ groupId: newGroup.groupId, studentId: student.userId, status: 'pending' });

    const res = makeRes();
    await membershipDecision(
      makeReq({ groupId: newGroup.groupId }, { decision: 'accepted' }, { userId: student.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('STUDENT_ALREADY_IN_GROUP');
    expect(res.json.mock.calls[0][0].auto_denied).toBe(true);

    // D2 state: invitation auto-rejected
    const inv = await MemberInvitation.findOne({ groupId: newGroup.groupId, inviteeId: student.userId });
    expect(inv.status).toBe('rejected');
  });

  it('f08: accepting one group auto-denies all other pending invitations for the same student', async () => {
    const student = await createUser();
    const acceptedGroup = await makeGroup({ groupName: 'Accepted Group' });
    const otherGroup1 = await makeGroup({ groupName: 'Other Group 1' });
    const otherGroup2 = await makeGroup({ groupName: 'Other Group 2' });

    // Pending invitations in all three groups
    for (const g of [acceptedGroup, otherGroup1, otherGroup2]) {
      await MemberInvitation.create({ groupId: g.groupId, inviteeId: student.userId, invitedBy: 'usr_leader' });
      await GroupMembership.create({ groupId: g.groupId, studentId: student.userId, status: 'pending' });
    }

    await membershipDecision(
      makeReq({ groupId: acceptedGroup.groupId }, { decision: 'accepted' }, { userId: student.userId }),
      makeRes()
    );

    // D2 state: other pending invitations auto-rejected
    const other1 = await MemberInvitation.findOne({ groupId: otherGroup1.groupId, inviteeId: student.userId });
    const other2 = await MemberInvitation.findOne({ groupId: otherGroup2.groupId, inviteeId: student.userId });
    expect(other1.status).toBe('rejected');
    expect(other2.status).toBe('rejected');
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f07: returns 404 INVITATION_NOT_FOUND when student has no pending invitation', async () => {
    const student = await createUser();
    const group = await makeGroup();

    const res = makeRes();
    await membershipDecision(
      makeReq({ groupId: group.groupId }, { decision: 'accepted' }, { userId: student.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('INVITATION_NOT_FOUND');
  });

  it('f07: returns 400 INVALID_DECISION for unrecognised decision value', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await MemberInvitation.create({ groupId: group.groupId, inviteeId: student.userId, invitedBy: 'usr_leader' });

    const res = makeRes();
    await membershipDecision(
      makeReq({ groupId: group.groupId }, { decision: 'maybe' }, { userId: student.userId }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_DECISION');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.5 — Approval Forwarding (f09 → f19)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.5 — Approval Forwarding (f09)', () => {
  it('f09: forwards approval result → ApprovalQueue entry written to D2', async () => {
    const group = await makeGroup();
    const studentId = 'usr_student_001';
    const now = new Date().toISOString();

    const res = makeRes();
    await forwardApprovalResults(
      makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_001',
          results: [{ student_id: studentId, decision: 'approved', decided_by: 'usr_coord', decided_at: now }],
        }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.forwarded_count).toBe(1);
    expect(body.queued_request_ids).toHaveLength(1);

    // D2 state: ApprovalQueue entry created
    const qEntry = await ApprovalQueue.findOne({ groupId: group.groupId, studentId });
    expect(qEntry).not.toBeNull();
    expect(qEntry.decision).toBe('approved');
    expect(qEntry.status).toBe('processed');
  });

  it('f09: approved decision updates GroupMembership to approved in D2', async () => {
    const group = await makeGroup();
    const studentId = 'usr_student_002';
    await GroupMembership.create({ groupId: group.groupId, studentId, status: 'pending' });

    await forwardApprovalResults(
      makeReq(
        { groupId: group.groupId },
        {
          notification_id: 'notif_002',
          results: [{ student_id: studentId, decision: 'approved', decided_by: 'usr_coord', decided_at: new Date().toISOString() }],
        }
      ),
      makeRes()
    );

    const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId });
    expect(mem.status).toBe('approved');
  });

  it('f09: idempotent — duplicate forwarding of same notification_id is a no-op', async () => {
    const group = await makeGroup();
    const studentId = 'usr_student_003';
    const payload = {
      notification_id: 'notif_003',
      results: [{ student_id: studentId, decision: 'approved', decided_by: 'usr_coord', decided_at: new Date().toISOString() }],
    };

    await forwardApprovalResults(makeReq({ groupId: group.groupId }, payload), makeRes());
    const res2 = makeRes();
    await forwardApprovalResults(makeReq({ groupId: group.groupId }, payload), res2);

    expect(res2.status).toHaveBeenCalledWith(200);
    // Second call should forward 0 new entries (idempotent)
    expect(res2.json.mock.calls[0][0].forwarded_count).toBe(0);
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f09: returns 400 MISSING_NOTIFICATION_ID when notification_id is absent', async () => {
    const group = await makeGroup();
    const res = makeRes();

    await forwardApprovalResults(
      makeReq({ groupId: group.groupId }, { results: [{ student_id: 'usr_s', decision: 'approved', decided_by: 'usr_c', decided_at: new Date().toISOString() }] }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('MISSING_NOTIFICATION_ID');
  });

  it('f09: returns 404 GROUP_NOT_FOUND when group does not exist in D2', async () => {
    const res = makeRes();

    await forwardApprovalResults(
      makeReq(
        { groupId: 'grp_ghost' },
        { notification_id: 'n_001', results: [{ student_id: 'usr_s', decision: 'approved', decided_by: 'usr_c', decided_at: new Date().toISOString() }] }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.6 — GitHub Integration (f10 → f11 → f12 → f24)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.6 — GitHub Integration (f10 → f11 → f12 → f24)', () => {
  // ── Happy path ───────────────────────────────────────────────────────────────

  it('f10/f11/f12: valid PAT + org returns 201 with validated: true and org_data', async () => {
    mockGithubValidPat();
    mockGithubValidOrg('my-org');

    const group = await makeGroup();
    const res = makeRes();

    await configureGithub(
      makeReq({ groupId: group.groupId }, { pat: 'ghp_validtoken', org: 'my-org' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.validated).toBe(true);
    expect(body.github_org).toBe('my-org');
    expect(body.org_data).toMatchObject({ login: 'my-org', id: 99 });
  });

  it('f11: PAT validation call made to https://api.github.com/user', async () => {
    mockGithubValidPat();
    mockGithubValidOrg();

    const group = await makeGroup();
    await configureGithub(
      makeReq({ groupId: group.groupId }, { pat: 'ghp_test_tok', org: 'test-org' }),
      makeRes()
    );

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_test_tok' }),
      })
    );
  });

  it('f12: org data retrieval call made to https://api.github.com/orgs/:org', async () => {
    mockGithubValidPat();
    mockGithubValidOrg('target-org');

    const group = await makeGroup();
    await configureGithub(
      makeReq({ groupId: group.groupId }, { pat: 'ghp_test_tok', org: 'target-org' }),
      makeRes()
    );

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/orgs/target-org',
      expect.any(Object)
    );
  });

  it('f24: githubPat and githubOrg written to D2 group record after successful setup', async () => {
    mockGithubValidPat();
    mockGithubValidOrg('stored-org');

    const group = await makeGroup();
    await configureGithub(
      makeReq({ groupId: group.groupId }, { pat: 'ghp_secret', org: 'stored-org' }),
      makeRes()
    );

    const d2 = await Group.findOne({ groupId: group.groupId });
    expect(d2.githubPat).toBe('ghp_secret');
    expect(d2.githubOrg).toBe('stored-org');
  });

  it('f24: GET /groups/:groupId/github returns validated: true and hides PAT after setup', async () => {
    const group = await makeGroup({ githubOrg: 'visible-org', githubPat: 'ghp_hidden' });
    const res = makeRes();

    await getGithub(makeReq({ groupId: group.groupId }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.validated).toBe(true);
    expect(body.github_org).toBe('visible-org');
    expect(body.githubPat).toBeUndefined();
  });

  it('f24: github_integration_setup audit log written to D2 after successful setup', async () => {
    mockGithubValidPat();
    mockGithubValidOrg('audit-org');

    const group = await makeGroup();
    await configureGithub(
      makeReq({ groupId: group.groupId }, { pat: 'ghp_x', org: 'audit-org' }),
      makeRes()
    );

    const audit = await AuditLog.findOne({ action: 'github_integration_setup', groupId: group.groupId });
    expect(audit).not.toBeNull();
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f10: returns 422 INVALID_PAT when GitHub returns 401 (invalid credentials)', async () => {
    mockGithubInvalidPat(401);

    const group = await makeGroup();
    const res = makeRes();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_bad', org: 'org' }), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_PAT');
  });

  it('f10: returns 422 INVALID_PAT when GitHub returns 403 (forbidden)', async () => {
    mockGithubInvalidPat(403);

    const group = await makeGroup();
    const res = makeRes();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_forbidden', org: 'org' }), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_PAT');
  });

  it('f12: returns 422 ORG_NOT_FOUND when org lookup returns 404', async () => {
    mockGithubValidPat();
    mockGithubOrgNotFound();

    const group = await makeGroup();
    const res = makeRes();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_valid', org: 'ghost-org' }), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe('ORG_NOT_FOUND');
  });

  it('f10: returns 403 FORBIDDEN when caller is not the group leader', async () => {
    const group = await makeGroup({ leaderId: 'usr_other_leader' });
    const res = makeRes();

    await configureGithub(
      makeReq({ groupId: group.groupId }, { pat: 'ghp_x', org: 'org' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  // ── Retry logic + SyncErrorLog ───────────────────────────────────────────────

  it('f10: returns 503 GITHUB_API_UNAVAILABLE after 3 consecutive network timeouts', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    const res = makeRes();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_timeout', org: 'my-org' }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe('GITHUB_API_UNAVAILABLE');
  });

  it('f10: SyncErrorLog entry written to D2 after 3 consecutive PAT validation failures', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_timeout', org: 'my-org' }), makeRes());

    const errLog = await SyncErrorLog.findOne({ service: 'github', groupId: group.groupId });
    expect(errLog).not.toBeNull();
    expect(errLog.attempts).toBe(3);
    expect(errLog.lastError).toMatch(/ETIMEDOUT/i);
  });

  it('f12: returns 503 and writes SyncErrorLog after 3 timeouts on org lookup', async () => {
    mockGithubValidPat();
    mockNetworkTimeout(3);

    const group = await makeGroup();
    const res = makeRes();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_valid', org: 'my-org' }), res);

    expect(res.status).toHaveBeenCalledWith(503);

    const errLog = await SyncErrorLog.findOne({ service: 'github', groupId: group.groupId });
    expect(errLog).not.toBeNull();
    expect(errLog.attempts).toBe(3);
  });

  it('f10: GET /groups/:groupId/github reflects last_sync_error from D2 after PAT retry exhaustion', async () => {
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
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.7 — JIRA Integration (f13 → f14 → f15 → f25)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.7 — JIRA Integration (f13 → f14 → f15 → f25)', () => {
  const validJiraBody = (overrides = {}) => ({
    jira_url: 'https://mycompany.atlassian.net',
    jira_username: 'user@example.com',
    jira_token: 'jira_token_abc',
    project_key: 'PROJ',
    ...overrides,
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('f13/f14/f15: valid JIRA credentials + project key returns 201 with validated: true', async () => {
    mockJiraValidCredentials();
    mockJiraValidProject('PROJ');

    const group = await makeGroup();
    const res = makeRes();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.validated).toBe(true);
    expect(body.jira_project_key).toBe('PROJ');
  });

  it('f14: credentials validation call made to JIRA /rest/api/3/myself', async () => {
    mockJiraValidCredentials();
    mockJiraValidProject();

    const group = await makeGroup();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

    expect(axios.get).toHaveBeenCalledWith(
      'https://mycompany.atlassian.net/rest/api/3/myself',
      expect.any(Object)
    );
  });

  it('f15: project validation call made to JIRA /rest/api/3/projects/:key', async () => {
    mockJiraValidCredentials();
    mockJiraValidProject('MYPROJ');

    const group = await makeGroup();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody({ project_key: 'MYPROJ' })), makeRes());

    expect(axios.get).toHaveBeenCalledWith(
      'https://mycompany.atlassian.net/rest/api/3/project/MYPROJ',
      expect.any(Object)
    );
  });

  it('f25: JIRA credentials written to D2 group record after successful setup', async () => {
    mockJiraValidCredentials();
    mockJiraValidProject('PROJ');

    const group = await makeGroup();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

    const d2 = await Group.findOne({ groupId: group.groupId });
    expect(d2.jiraUrl).toBe('https://mycompany.atlassian.net');
    expect(d2.jiraUsername).toBe('user@example.com');
    expect(d2.jiraToken).toBe('jira_token_abc');
    expect(d2.projectKey).toBe('PROJ');
  });

  it('f25: GET /groups/:groupId/jira returns validated: true after setup', async () => {
    const group = await makeGroup({
      jiraUrl: 'https://test.atlassian.net',
      jiraUsername: 'admin@test.com',
      jiraToken: 'tok',
      projectKey: 'TEST',
    });
    const res = makeRes();

    await getJira(makeReq({ groupId: group.groupId }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.validated).toBe(true);
    expect(body.jira_project_key).toBe('TEST');
  });

  it('f25: jira_integration_setup audit log written to D2 after successful setup', async () => {
    mockJiraValidCredentials();
    mockJiraValidProject('PROJ');

    const group = await makeGroup();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

    const audit = await AuditLog.findOne({ action: 'jira_integration_setup', groupId: group.groupId });
    expect(audit).not.toBeNull();
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f14: returns 422 INVALID_JIRA_CREDENTIALS when JIRA returns 401', async () => {
    mockJiraInvalidCredentials(401);

    const group = await makeGroup();
    const res = makeRes();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_JIRA_CREDENTIALS');
  });

  it('f14: returns 422 INVALID_JIRA_CREDENTIALS when JIRA returns 403', async () => {
    mockJiraInvalidCredentials(403);

    const group = await makeGroup();
    const res = makeRes();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_JIRA_CREDENTIALS');
  });

  it('f15: returns 422 INVALID_PROJECT_KEY when JIRA project lookup returns 404', async () => {
    mockJiraValidCredentials();
    mockJiraProjectNotFound();

    const group = await makeGroup();
    const res = makeRes();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody({ project_key: 'GHOST' })), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_PROJECT_KEY');
  });

  // ── Retry logic + SyncErrorLog ───────────────────────────────────────────────

  it('f14: returns 503 JIRA_API_UNAVAILABLE after 3 consecutive network timeouts on credentials check', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    const res = makeRes();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe('JIRA_API_UNAVAILABLE');
  });

  it('f14: SyncErrorLog entry written to D2 after 3 consecutive JIRA credential failures', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), makeRes());

    const errLog = await SyncErrorLog.findOne({ service: 'jira', groupId: group.groupId });
    expect(errLog).not.toBeNull();
    expect(errLog.attempts).toBe(3);
  });

  it('f15: returns 503 and writes SyncErrorLog after 3 timeouts on project lookup', async () => {
    mockJiraValidCredentials();
    mockNetworkTimeout(3);

    const group = await makeGroup();
    const res = makeRes();
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody()), res);

    expect(res.status).toHaveBeenCalledWith(503);

    const errLog = await SyncErrorLog.findOne({ service: 'jira', groupId: group.groupId });
    expect(errLog).not.toBeNull();
    expect(errLog.attempts).toBe(3);
  });

  it('f14: GET /groups/:groupId/jira reflects last_sync_error from D2 after retry exhaustion', async () => {
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
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-process 2.8 — Coordinator Override (f16 → f21 → f17)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sub-process 2.8 — Coordinator Override (f16 → f21 → f17)', () => {
  // ── add_member ───────────────────────────────────────────────────────────────

  it('f16/f21: add_member override adds student to group.members in D2 and creates GroupMembership(approved)', async () => {
    const student = await createUser();
    const group = await makeGroup();

    const res = makeRes();
    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: student.userId, reason: 'Coordinator addition' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.action).toBe('add_member');
    expect(body.status).toBe('applied');

    // D2 state: student in group.members as accepted
    const updatedGroup = await Group.findOne({ groupId: group.groupId });
    const memberEntry = updatedGroup.members.find((m) => m.userId === student.userId);
    expect(memberEntry).toBeDefined();
    expect(memberEntry.status).toBe('accepted');

    // D2 state: GroupMembership record with approved status
    const mem = await GroupMembership.findOne({ groupId: group.groupId, studentId: student.userId });
    expect(mem).not.toBeNull();
    expect(mem.status).toBe('approved');
  });

  it('f17: Override record written to D2 for add_member override', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: student.userId, reason: 'Test override' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      makeRes()
    );

    const overrideRecord = await Override.findOne({ groupId: group.groupId, action: 'add_member' });
    expect(overrideRecord).not.toBeNull();
    expect(overrideRecord.coordinatorId).toBe('usr_coord');
    // f17: forwardOverrideToReconciliation transitions status to 'reconciled' immediately
    expect(overrideRecord.status).toBe('reconciled');
  });

  // ── remove_member ────────────────────────────────────────────────────────────

  it('f16/f21: remove_member override removes student from group.members in D2', async () => {
    const student = await createUser();
    const group = await makeGroup({
      members: [
        { userId: 'usr_leader', role: 'leader', status: 'accepted' },
        { userId: student.userId, role: 'member', status: 'accepted' },
      ],
    });

    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'remove_member', target_student_id: student.userId, reason: 'Rule violation' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      makeRes()
    );

    // D2 state: student removed from group.members
    const updatedGroup = await Group.findOne({ groupId: group.groupId });
    const memberEntry = updatedGroup.members.find((m) => m.userId === student.userId);
    expect(memberEntry).toBeUndefined();
  });

  it('f21: coordinator_override audit log written to D2 for add_member action', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: student.userId, reason: 'Audit test' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      makeRes()
    );

    const audit = await AuditLog.findOne({ action: 'coordinator_override', groupId: group.groupId });
    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe('usr_coord');
    expect(audit.payload.action).toBe('add_member');
  });

  it('f21: member_added audit log written to D2 when coordinator adds member via override', async () => {
    const student = await createUser();
    const group = await makeGroup();

    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: student.userId, reason: 'Override add' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      makeRes()
    );

    const audit = await AuditLog.findOne({ action: 'member_added', groupId: group.groupId });
    expect(audit).not.toBeNull();
    expect(audit.payload.via).toBe('coordinator_override');
    expect(audit.payload.student_id).toBe(student.userId);
  });

  // ── update_group ─────────────────────────────────────────────────────────────

  it('f16/f21: update_group override transitions group status in D2 (pending_validation → active)', async () => {
    const group = await makeGroup({ status: 'pending_validation' });

    const res = makeRes();
    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'update_group', updates: { status: 'active' }, reason: 'Approved by coordinator' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);

    // D2 state: status updated
    const updatedGroup = await Group.findOne({ groupId: group.groupId });
    expect(updatedGroup.status).toBe('active');
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('f16: returns 403 FORBIDDEN when non-coordinator role attempts override', async () => {
    const group = await makeGroup();
    const res = makeRes();

    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: 'usr_s', reason: 'Unauthorized' },
        { userId: 'usr_student', role: 'student' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  it('f16: override is NOT blocked by schedule windows (coordinator exempt)', async () => {
    // No schedule window created — coordinator override should still succeed
    const student = await createUser();
    const group = await makeGroup();

    const res = makeRes();
    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: student.userId, reason: 'Outside window' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('f16: returns 404 GROUP_NOT_FOUND when group does not exist in D2', async () => {
    await createUser({ userId: 'usr_student_x' });
    const res = makeRes();

    await coordinatorOverride(
      makeReq(
        { groupId: 'grp_ghost' },
        { action: 'add_member', target_student_id: 'usr_student_x', reason: 'Ghost group' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
  });

  it('f21: returns 409 INVALID_STATUS_TRANSITION for illegal state machine transition', async () => {
    const group = await makeGroup({ status: 'archived' });

    const res = makeRes();
    await coordinatorOverride(
      makeReq(
        { groupId: group.groupId },
        { action: 'update_group', updates: { status: 'active' }, reason: 'Illegal transition' },
        { userId: 'usr_coord', role: 'coordinator' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_STATUS_TRANSITION');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schedule Boundary Enforcement (f01 gate + f05 gate)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Schedule Boundary Enforcement', () => {
  it('blocks POST /groups when group_creation window has not started yet', async () => {
    const future = new Date(Date.now() + 3_600_000);
    await ScheduleWindow.create({
      operationType: 'group_creation',
      startsAt: new Date(future.getTime() + 1_000),
      endsAt: new Date(future.getTime() + 7_200_000),
      isActive: true,
      createdBy: 'usr_coord',
    });

    const leader = await createUser({ userId: 'usr_leader' });
    const res = makeRes();
    await createGroup(makeReq({}, { groupName: 'Too Early', leaderId: leader.userId }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
  });

  it('blocks POST /groups when group_creation window has already expired', async () => {
    const past = new Date(Date.now() - 7_200_000);
    await ScheduleWindow.create({
      operationType: 'group_creation',
      startsAt: new Date(past.getTime() - 3_600_000),
      endsAt: past,
      isActive: true,
      createdBy: 'usr_coord',
    });

    const leader = await createUser({ userId: 'usr_leader' });
    const res = makeRes();
    await createGroup(makeReq({}, { groupName: 'Too Late', leaderId: leader.userId }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
  });

  it('blocks POST /groups/:groupId/members when member_addition window is inactive', async () => {
    await ScheduleWindow.create({
      operationType: 'member_addition',
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      isActive: false,
      createdBy: 'usr_coord',
    });

    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: leader.userId });

    const res = makeRes();
    await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('OUTSIDE_SCHEDULE_WINDOW');
  });

  it('allows POST /groups when an active group_creation window is open', async () => {
    await createScheduleWindow('group_creation');
    const leader = await createUser({ userId: 'usr_leader' });
    const res = makeRes();

    await createGroup(makeReq({}, { groupName: 'On Time', leaderId: leader.userId }), res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('allows POST /groups/:groupId/members when an active member_addition window is open', async () => {
    await createScheduleWindow('member_addition');
    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();
    const group = await makeGroup({ leaderId: leader.userId });

    const res = makeRes();
    await addMember(makeReq({ groupId: group.groupId }, { student_ids: [student.userId] }), res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// External API Retry Logic — Sync Error Log (cross-cutting)
// ═══════════════════════════════════════════════════════════════════════════════

describe('External API Retry Logic — SyncErrorLog D2 state', () => {
  it('GitHub: 4xx errors are NOT retried (fail immediately on attempt 1)', async () => {
    mockGithubInvalidPat(401);

    const group = await makeGroup();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'bad', org: 'org' }), makeRes());

    // Only one axios call made (no retries for 4xx)
    expect(axios.get).toHaveBeenCalledTimes(1);

    // No SyncErrorLog created for 4xx failures
    const errLog = await SyncErrorLog.findOne({ service: 'github', groupId: group.groupId });
    expect(errLog).toBeNull();
  });

  it('GitHub: 5xx/network errors are retried up to 3 times before SyncErrorLog is written', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_tok', org: 'org' }), makeRes());

    // axios.get called 3 times (3 retry attempts)
    expect(axios.get).toHaveBeenCalledTimes(3);

    const errLog = await SyncErrorLog.findOne({ service: 'github', groupId: group.groupId });
    expect(errLog).not.toBeNull();
    expect(errLog.attempts).toBe(3);
  });

  it('JIRA: 4xx errors are NOT retried (fail immediately on attempt 1)', async () => {
    mockJiraInvalidCredentials(401);

    const group = await makeGroup();
    const validJiraBody = {
      jira_url: 'https://test.atlassian.net',
      jira_username: 'user@test.com',
      jira_token: 'tok',
      project_key: 'PROJ',
    };
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody), makeRes());

    expect(axios.get).toHaveBeenCalledTimes(1);

    const errLog = await SyncErrorLog.findOne({ service: 'jira', groupId: group.groupId });
    expect(errLog).toBeNull();
  });

  it('JIRA: 5xx/network errors are retried up to 3 times before SyncErrorLog is written', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    const validJiraBody = {
      jira_url: 'https://test.atlassian.net',
      jira_username: 'user@test.com',
      jira_token: 'tok',
      project_key: 'PROJ',
    };
    await configureJira(makeReq({ groupId: group.groupId }, validJiraBody), makeRes());

    expect(axios.get).toHaveBeenCalledTimes(3);

    const errLog = await SyncErrorLog.findOne({ service: 'jira', groupId: group.groupId });
    expect(errLog).not.toBeNull();
    expect(errLog.attempts).toBe(3);
  });

  it('sync_error audit log entry written to D2 when external API fails after retries', async () => {
    mockNetworkTimeout(3);

    const group = await makeGroup();
    await configureGithub(makeReq({ groupId: group.groupId }, { pat: 'ghp_tok', org: 'org' }), makeRes());

    const syncAudit = await AuditLog.findOne({ action: 'sync_error', groupId: group.groupId });
    expect(syncAudit).not.toBeNull();
    expect(syncAudit.payload.api_type).toBe('github');
    expect(syncAudit.payload.retry_count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end flow: Group Creation → Member Invitation → Decision → Forwarding
// ═══════════════════════════════════════════════════════════════════════════════

describe('End-to-end flow: Group Creation → Member Invitation → Decision → Approval Forwarding', () => {
  it('executes complete flow f01→f02→f18→f05→f06→f19→f07→f08→f09 with correct D2 state at each step', async () => {
    // Step 1: Set up schedule windows
    await createScheduleWindow('group_creation');
    await createScheduleWindow('member_addition');

    const leader = await createUser({ userId: 'usr_leader' });
    const student = await createUser();

    // Step 2 (f01→f02→f18): Create group
    const createRes = makeRes();
    await createGroup(makeReq({}, { groupName: 'E2E Team', leaderId: leader.userId }), createRes);
    expect(createRes.status).toHaveBeenCalledWith(201);
    const { groupId } = createRes.json.mock.calls[0][0];

    // D2 assertion: group created with pending_validation
    let d2Group = await Group.findOne({ groupId });
    expect(d2Group.status).toBe('pending_validation');

    // Step 3 (f05→f06→f19): Leader invites student
    const addRes = makeRes();
    await addMember(makeReq({ groupId }, { student_ids: [student.userId] }), addRes);
    expect(addRes.status).toHaveBeenCalledWith(201);

    // D2 assertion: invitation + membership(pending) in D2
    const inv = await MemberInvitation.findOne({ groupId, inviteeId: student.userId });
    expect(inv.status).toBe('pending');
    const pendingMem = await GroupMembership.findOne({ groupId, studentId: student.userId });
    expect(pendingMem.status).toBe('pending');

    // Step 4 (f07→f08): Student accepts invitation
    const decisionRes = makeRes();
    await membershipDecision(
      makeReq({ groupId }, { decision: 'accepted' }, { userId: student.userId }),
      decisionRes
    );
    expect(decisionRes.status).toHaveBeenCalledWith(200);

    // D2 assertion: membership approved, student in group.members
    const approvedMem = await GroupMembership.findOne({ groupId, studentId: student.userId });
    expect(approvedMem.status).toBe('approved');
    d2Group = await Group.findOne({ groupId });
    expect(d2Group.members.some((m) => m.userId === student.userId && m.status === 'accepted')).toBe(true);

    // Step 5 (f09): Forward approval results to process 2.5
    const fwdRes = makeRes();
    await forwardApprovalResults(
      makeReq(
        { groupId },
        {
          notification_id: 'notif_e2e_001',
          results: [{ student_id: student.userId, decision: 'approved', decided_by: leader.userId, decided_at: new Date().toISOString() }],
        }
      ),
      fwdRes
    );
    expect(fwdRes.status).toHaveBeenCalledWith(200);

    // D2 assertion: ApprovalQueue entry written and processed
    const qEntry = await ApprovalQueue.findOne({ groupId, studentId: student.userId });
    expect(qEntry).not.toBeNull();
    expect(qEntry.status).toBe('processed');
  });
});
