/**
 * Coordinator Override Integration Tests
 *
 * Tests for the coordinatorOverride controller (PATCH /groups/:groupId/override).
 * Process 2.8 — DFD flows f16 (Coordinator → 2.8), f21 (2.8 → D2), f17 (2.8 → 2.5).
 *
 * Run: npm test -- coordinatorOverride.test.js
 */

const mongoose = require('mongoose');

describe('PATCH /groups/:groupId/override — coordinatorOverride', () => {
  const mongoUri =
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/senior-app-test-coordinator-override';

  let Group;
  let GroupMembership;
  let Override;
  let User;
  let coordinatorOverride;

  // ── Test helpers ─────────────────────────────────────────────────────────────

  const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
    params,
    body,
    user: { userId: 'usr_coordinator', role: 'coordinator', ...userOverrides },
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
      ...overrides,
    });

  const makeStudent = (overrides = {}) =>
    User.create({
      userId: `usr_stu_${Date.now()}-${Math.random()}`,
      email: `student_${Date.now()}@test.com`,
      hashedPassword: 'hashed',
      role: 'student',
      accountStatus: 'active',
      ...overrides,
    });

  // ── Setup / teardown ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();

    Group = require('../src/models/Group');
    GroupMembership = require('../src/models/GroupMembership');
    Override = require('../src/models/Override');
    User = require('../src/models/User');
    ({ coordinatorOverride } = require('../src/controllers/groups'));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      Group.deleteMany({}),
      GroupMembership.deleteMany({}),
      Override.deleteMany({}),
      User.deleteMany({}),
    ]);
  });

  // ── Happy path: add_member ────────────────────────────────────────────────────

  describe('action: add_member', () => {
    it('returns 200 with override_id, action, status applied, confirmation, timestamp', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      const req = makeReq(
        { groupId: group.groupId },
        { action: 'add_member', target_student_id: student.userId, reason: 'Project reassignment' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.override_id).toMatch(/^ovr_/);
      expect(body.action).toBe('add_member');
      expect(body.status).toBe('applied');
      expect(body.confirmation).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('adds the student to Group.members with status accepted (f21: D2 update)', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'add_member', target_student_id: student.userId, reason: 'Override' }
        ),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeDefined();
      expect(member.status).toBe('accepted');
      expect(member.role).toBe('member');
      expect(member.joinedAt).toBeDefined();
    });

    it('upserts GroupMembership with status approved (f21: D2 update)', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'add_member', target_student_id: student.userId, reason: 'Override' }
        ),
        makeRes()
      );

      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: student.userId,
      });
      expect(membership).not.toBeNull();
      expect(membership.status).toBe('approved');
      expect(membership.decidedBy).toBe('usr_coordinator');
    });

    it('forwards override to process 2.5 — Override record has status reconciled (f17)', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'add_member', target_student_id: student.userId, reason: 'Override' }
        ),
        makeRes()
      );

      const override = await Override.findOne({ groupId: group.groupId, targetStudentId: student.userId });
      expect(override).not.toBeNull();
      expect(override.status).toBe('reconciled');
      expect(override.reconciledAt).toBeDefined();
    });

    it('is idempotent — re-adding an already-accepted member does not duplicate members', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      const body = { action: 'add_member', target_student_id: student.userId, reason: 'Override' };

      await coordinatorOverride(makeReq({ groupId: group.groupId }, body), makeRes());
      await coordinatorOverride(makeReq({ groupId: group.groupId }, body), makeRes());

      const updated = await Group.findOne({ groupId: group.groupId });
      const entries = updated.members.filter((m) => m.userId === student.userId);
      expect(entries).toHaveLength(1);
    });
  });

  // ── Happy path: remove_member ─────────────────────────────────────────────────

  describe('action: remove_member', () => {
    it('returns 200 with override_id, action, status applied, confirmation, timestamp', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      group.members.push({ userId: student.userId, role: 'member', status: 'accepted', joinedAt: new Date() });
      await group.save();

      const req = makeReq(
        { groupId: group.groupId },
        { action: 'remove_member', target_student_id: student.userId, reason: 'Policy violation' }
      );
      const res = makeRes();

      await coordinatorOverride(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.override_id).toMatch(/^ovr_/);
      expect(body.action).toBe('remove_member');
      expect(body.status).toBe('applied');
    });

    it('removes the student from Group.members (f21: D2 update)', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      group.members.push({ userId: student.userId, role: 'member', status: 'accepted', joinedAt: new Date() });
      await group.save();

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'remove_member', target_student_id: student.userId, reason: 'Override' }
        ),
        makeRes()
      );

      const updated = await Group.findOne({ groupId: group.groupId });
      const member = updated.members.find((m) => m.userId === student.userId);
      expect(member).toBeUndefined();
    });

    it('updates GroupMembership status to rejected (f21: D2 update)', async () => {
      const group = await makeGroup();
      const student = await makeStudent();
      await GroupMembership.create({
        groupId: group.groupId,
        studentId: student.userId,
        status: 'approved',
        decidedBy: 'usr_leader',
        decidedAt: new Date(),
      });

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'remove_member', target_student_id: student.userId, reason: 'Override' }
        ),
        makeRes()
      );

      const membership = await GroupMembership.findOne({
        groupId: group.groupId,
        studentId: student.userId,
      });
      expect(membership.status).toBe('rejected');
      expect(membership.decidedBy).toBe('usr_coordinator');
    });

    it('forwards override to process 2.5 — Override record has status reconciled (f17)', async () => {
      const group = await makeGroup();
      const student = await makeStudent();

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'remove_member', target_student_id: student.userId, reason: 'Override' }
        ),
        makeRes()
      );

      const override = await Override.findOne({ groupId: group.groupId, action: 'remove_member' });
      expect(override.status).toBe('reconciled');
    });
  });

  // ── 400 Bad Request ───────────────────────────────────────────────────────────

  describe('400 Bad Request', () => {
    it('returns 400 INVALID_ACTION when action is missing', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await coordinatorOverride(
        makeReq({ groupId: group.groupId }, { target_student_id: 'usr_x', reason: 'test' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_ACTION');
    });

    it('returns 400 INVALID_ACTION when action is unrecognized', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await coordinatorOverride(
        makeReq({ groupId: group.groupId }, { action: 'kick_member', target_student_id: 'usr_x', reason: 'test' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('INVALID_ACTION');
    });

    it('returns 400 MISSING_TARGET_STUDENT when target_student_id is missing', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await coordinatorOverride(
        makeReq({ groupId: group.groupId }, { action: 'add_member', reason: 'test' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_TARGET_STUDENT');
    });

    it('returns 400 MISSING_REASON when reason is missing', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await coordinatorOverride(
        makeReq({ groupId: group.groupId }, { action: 'add_member', target_student_id: 'usr_x' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_REASON');
    });

    it('returns 400 MISSING_REASON when reason is whitespace only', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await coordinatorOverride(
        makeReq({ groupId: group.groupId }, { action: 'add_member', target_student_id: 'usr_x', reason: '   ' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('MISSING_REASON');
    });
  });

  // ── 404 Not Found ─────────────────────────────────────────────────────────────

  describe('404 Not Found', () => {
    it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
      const student = await makeStudent();
      const res = makeRes();

      await coordinatorOverride(
        makeReq(
          { groupId: 'grp_nonexistent' },
          { action: 'add_member', target_student_id: student.userId, reason: 'Override' }
        ),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('GROUP_NOT_FOUND');
    });

    it('returns 404 STUDENT_NOT_FOUND when target student does not exist', async () => {
      const group = await makeGroup();
      const res = makeRes();

      await coordinatorOverride(
        makeReq(
          { groupId: group.groupId },
          { action: 'add_member', target_student_id: 'usr_ghost', reason: 'Override' }
        ),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe('STUDENT_NOT_FOUND');
    });
  });
});
