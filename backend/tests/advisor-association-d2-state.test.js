/**
 * Advisor Association Endpoints & D2 State — Contract Tests (Issue #75)
 *
 * HTTP integration tests via supertest against mounted Express routes.
 */

'use strict';

jest.mock('../src/services/notificationService', () => {
  const actual = jest.requireActual('../src/services/notificationService');
  return {
    ...actual,
    dispatchAdvisorRequestNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_req_001' }),
    dispatchAdvisorDecisionNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_dec_001' }),
    dispatchAdvisorTransferNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_transfer_001' }),
    dispatchGroupDisbandNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_disband_001' }),
  };
});

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-advisor-association-contract';
process.env.MONGODB_URI = MONGO_URI;

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/index');

const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const Group = require('../src/models/Group');
const AdvisorRequest = require('../src/models/AdvisorRequest');
const ScheduleWindow = require('../src/models/ScheduleWindow');
const notificationService = require('../src/services/notificationService');
const { generateTokenPair } = require('../src/utils/jwt');
const OT = require('../src/utils/operationTypes');

const uid = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const createUser = async (overrides = {}) =>
  User.create({
    userId: uid('usr'),
    email: `${uid('mail')}@test.edu`,
    hashedPassword: 'hashed',
    accountStatus: 'active',
    role: 'student',
    ...overrides,
  });

const openAdvisorWindow = async (operationType, overrides = {}) => {
  const now = new Date();
  return ScheduleWindow.create({
    windowId: uid('sw'),
    operationType,
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 3_600_000),
    isActive: true,
    createdBy: 'usr_coord',
    ...overrides,
  });
};

const createGroupDoc = async (overrides = {}) => {
  const groupName = overrides.groupName || uid('GroupName');
  return Group.create({
    groupId: overrides.groupId || uid('grp'),
    groupName,
    leaderId: overrides.leaderId ?? 'usr_leader',
    status: overrides.status ?? 'active',
    advisorStatus: overrides.advisorStatus ?? 'pending',
    professorId: overrides.professorId ?? null,
    ...overrides,
  });
};

describe('Issue #75 — Advisor Association Endpoints & D2 State (contract)', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoose.connect(MONGO_URI);
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      AuditLog.deleteMany({}),
      Group.deleteMany({}),
      AdvisorRequest.deleteMany({}),
      ScheduleWindow.deleteMany({}),
    ]);
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('POST /api/v1/advisor-requests', () => {
    it('returns 201 with requestId and notificationTriggered=true for valid submission', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const leader = await createUser({ userId: 'usr_leader', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_1', role: 'professor' });
      const group = await createGroupDoc({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });
      const token = generateTokenPair(leader.userId, 'student').accessToken;
      const spy = jest.spyOn(notificationService, 'dispatchAdvisorRequestNotification');

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(201);
      expect(res.body.requestId).toBeTruthy();
      expect(res.body.notificationTriggered).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: group.groupId, professorId: professor.userId })
      );
    });

    it('returns 403 for non-team-leader', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_2', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_real_leader' });
      const token = generateTokenPair('usr_not_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(403);
    });

    it('returns 409 when group already has advisor', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_3', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: 'usr_leader',
        advisorStatus: 'assigned',
        professorId: professor.userId,
      });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(409);
    });

    it('returns 409 when group already has pending advisor request', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_4', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_leader' });
      await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(409);
    });

    it('returns 422 when request is out-of-window', async () => {
      const now = new Date();
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION, {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const professor = await createUser({ userId: 'usr_prof_5', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_leader' });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(422);
    });

    it('returns 422 when advisor window is inactive', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION, { isActive: false });
      const professor = await createUser({ userId: 'usr_prof_5b', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_leader' });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(422);
    });

    it('returns 404 when group is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_6', role: 'professor' });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: 'grp_missing', professorId: professor.userId });

      expect(res.status).toBe(404);
    });

    it('returns 404 when professor is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const group = await createGroupDoc({ leaderId: 'usr_leader' });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: 'usr_prof_missing' });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/advisor-requests/:requestId', () => {
    it('approve returns 200 and assignedGroupId', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_dec_1', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending' });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body.assignedGroupId).toBe(group.groupId);
    });

    it('reject returns 200', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_dec_2', role: 'professor' });
      const reqDoc = await AdvisorRequest.create({
        professorId: professor.userId,
        status: 'pending',
        groupId: (await createGroupDoc()).groupId,
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject' });

      expect(res.status).toBe(200);
    });

    it('returns 403 for non-professor actor', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const reqDoc = await AdvisorRequest.create({
        professorId: 'usr_prof_x',
        status: 'pending',
        groupId: (await createGroupDoc()).groupId,
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair('usr_student', 'student').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(403);
    });

    it('should return 403 when a different professor attempts to decide on a request', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professorA = await createUser({ userId: 'usr_prof_idor_a', role: 'professor' });
      const professorB = await createUser({ userId: 'usr_prof_idor_b', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_leader' });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professorA.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });
      const tokenB = generateTokenPair(professorB.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(tokenB))
        .send({ decision: 'approve' });

      expect(res.status).toBe(403);

      const unchanged = await AdvisorRequest.findOne({ requestId: reqDoc.requestId }).lean();
      expect(unchanged.status).toBe('pending');
    });

    it('returns 409 when request already processed', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_dec_3', role: 'professor' });
      const reqDoc = await AdvisorRequest.create({
        professorId: professor.userId,
        status: 'approved',
        groupId: (await createGroupDoc()).groupId,
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when out-of-window', async () => {
      const now = new Date();
      await openAdvisorWindow(OT.ADVISOR_DECISION, {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const professor = await createUser({ userId: 'usr_prof_dec_4', role: 'professor' });
      const reqDoc = await AdvisorRequest.create({
        professorId: professor.userId,
        status: 'pending',
        groupId: (await createGroupDoc()).groupId,
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(422);
    });

    it('returns 404 when request is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_dec_5', role: 'professor' });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch('/api/v1/advisor-requests/arq_missing')
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/groups/:groupId/advisor', () => {
    it('valid release returns 200 and sets D2 state to released', async () => {
      await openAdvisorWindow(OT.ADVISOR_RELEASE);
      const group = await createGroupDoc({
        leaderId: 'usr_leader',
        advisorStatus: 'assigned',
        professorId: 'usr_prof_rel_1',
      });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(bearer(token));

      expect(res.status).toBe(200);
      const updated = await Group.findOne({ groupId: group.groupId }).lean();
      expect(updated.professorId).toBeNull();
      expect(updated.advisorStatus).toBe('released');
    });

    it('returns 409 when there is no current advisor', async () => {
      await openAdvisorWindow(OT.ADVISOR_RELEASE);
      const group = await createGroupDoc({ leaderId: 'usr_leader', advisorStatus: 'pending', professorId: null });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(bearer(token));

      expect(res.status).toBe(409);
    });

    it('returns 403 for non-leader and non-coordinator', async () => {
      await openAdvisorWindow(OT.ADVISOR_RELEASE);
      const group = await createGroupDoc({
        leaderId: 'usr_leader',
        advisorStatus: 'assigned',
        professorId: 'usr_prof_rel_2',
      });
      const token = generateTokenPair('usr_random', 'student').accessToken;

      const res = await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(bearer(token));

      expect(res.status).toBe(403);
    });

    it('returns 422 when out-of-window', async () => {
      const now = new Date();
      await openAdvisorWindow(OT.ADVISOR_RELEASE, {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const group = await createGroupDoc({
        leaderId: 'usr_leader',
        advisorStatus: 'assigned',
        professorId: 'usr_prof_rel_3',
      });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(bearer(token));

      expect(res.status).toBe(422);
    });

    it('returns 404 when group is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_RELEASE);
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app).delete('/api/v1/groups/grp_missing/advisor').set(bearer(token));

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/groups/:groupId/advisor/transfer', () => {
    it('valid transfer returns 200 and updates D2 state to transferred', async () => {
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      const oldProfessor = await createUser({ userId: 'usr_prof_old', role: 'professor' });
      const newProfessor = await createUser({ userId: 'usr_prof_new', role: 'professor' });
      const coord = await createUser({ userId: 'usr_coord', role: 'coordinator' });
      const group = await createGroupDoc({ advisorStatus: 'assigned', professorId: oldProfessor.userId });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(token))
        .send({ targetProfessorId: newProfessor.userId });

      expect(res.status).toBe(200);
      const updated = await Group.findOne({ groupId: group.groupId }).lean();
      expect(updated.professorId).toBe(newProfessor.userId);
      expect(updated.advisorStatus).toBe('transferred');
    });

    it('returns 403 for non-coordinator', async () => {
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      const group = await createGroupDoc({ advisorStatus: 'assigned', professorId: 'usr_prof_current' });
      const token = generateTokenPair('usr_leader', 'student').accessToken;

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(token))
        .send({ targetProfessorId: 'usr_prof_target' });

      expect(res.status).toBe(403);
    });

    it('returns 409 when target professor has conflict', async () => {
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      const target = await createUser({ userId: 'usr_prof_conflict', role: 'professor' });
      await createGroupDoc({ groupId: uid('grp_conflict_a'), groupName: uid('GN'), advisorStatus: 'assigned', professorId: target.userId });
      const group = await createGroupDoc({
        groupId: uid('grp_conflict_b'),
        groupName: uid('GN2'),
        advisorStatus: 'assigned',
        professorId: 'usr_prof_other',
      });
      const coord = await createUser({ userId: 'usr_coord_ct', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(token))
        .send({ targetProfessorId: target.userId });

      expect(res.status).toBe(409);
    });

    it('returns 422 when out-of-window', async () => {
      const now = new Date();
      await openAdvisorWindow(OT.ADVISOR_TRANSFER, {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const group = await createGroupDoc({ advisorStatus: 'assigned', professorId: 'usr_prof_current_2' });
      const coord = await createUser({ userId: 'usr_coord_ow', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(token))
        .send({ targetProfessorId: 'usr_prof_target_2' });

      expect(res.status).toBe(422);
    });

    it('returns 404 when group is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      const coord = await createUser({ userId: 'usr_coord_nf', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/grp_missing/advisor/transfer')
        .set(bearer(token))
        .send({ targetProfessorId: 'usr_prof_target_3' });

      expect(res.status).toBe(404);
    });

    it('returns 404 when target professor is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      const group = await createGroupDoc({ advisorStatus: 'assigned', professorId: 'usr_prof_current_3' });
      const coord = await createUser({ userId: 'usr_coord_nf2', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(token))
        .send({ targetProfessorId: 'usr_prof_nonexistent' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/groups/advisor-sanitization', () => {
    it('returns 409 before deadline', async () => {
      const now = new Date();
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION, {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const coord = await createUser({ userId: 'usr_coord_s', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(409);
    });

    it('returns 403 for non-coordinator and non-system actor', async () => {
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);
      const token = generateTokenPair('usr_student', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(403);
    });

    it('returns 200 with disbandedGroups[] for valid execution', async () => {
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);
      const g1 = await createGroupDoc({ advisorStatus: 'released', professorId: null });
      const g2 = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      await createGroupDoc({ advisorStatus: 'assigned', professorId: 'usr_prof_safe' });
      const coord = await createUser({ userId: 'usr_coord_exec', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.disbandedGroups)).toBe(true);
      expect(res.body.disbandedGroups).toEqual(expect.arrayContaining([g1.groupId, g2.groupId]));
    });

    it('disbands pending advisor-less groups at minimum (contract floor)', async () => {
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);
      const pendingGroup = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      await createGroupDoc({ advisorStatus: 'assigned', professorId: 'usr_prof_safe_2' });
      const coord = await createUser({ userId: 'usr_coord_min', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
      expect(res.body.disbandedGroups).toEqual(expect.arrayContaining([pendingGroup.groupId]));
    });
  });

  describe('D2 state transitions + audit trail assertions', () => {
    it('approve transition sets advisorStatus=assigned and creates advisor_approved audit log', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_d2_1', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(200);
      const updated = await Group.findOne({ groupId: group.groupId }).lean();
      expect(updated.advisorStatus).toBe('assigned');
      expect(updated.professorId).toBe(professor.userId);

      const log = await AuditLog.findOne({ action: 'advisor_approved', groupId: group.groupId }).lean();
      expect(log).not.toBeNull();
      expect(log.actorId).toBe(professor.userId);
      expect(log.targetId).toBe(reqDoc.requestId);
      expect(log.payload).toMatchObject({
        requestId: reqDoc.requestId,
        groupId: group.groupId,
        decision: 'approve',
        professorId: professor.userId,
      });
    });

    it('request submission/reject/release/transfer/disband write required audit actions', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      await openAdvisorWindow(OT.ADVISOR_RELEASE);
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);

      const leader = await createUser({ userId: 'usr_leader_audit', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_audit', role: 'professor' });
      const targetProfessor = await createUser({ userId: 'usr_prof_audit_2', role: 'professor' });
      const coord = await createUser({ userId: 'usr_coord_audit', role: 'coordinator' });
      const group = await createGroupDoc({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });

      const submitRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(generateTokenPair(leader.userId, 'student').accessToken))
        .send({ groupId: group.groupId, professorId: professor.userId });
      expect(submitRes.status).toBe(201);

      const pendingReq = await AdvisorRequest.findOne({ groupId: group.groupId });
      expect(pendingReq).not.toBeNull();

      await request(app)
        .patch(`/api/v1/advisor-requests/${pendingReq.requestId}`)
        .set(bearer(generateTokenPair(professor.userId, 'professor').accessToken))
        .send({ decision: 'reject' });

      await Group.updateOne(
        { groupId: group.groupId },
        { $set: { advisorStatus: 'assigned', professorId: professor.userId } }
      );

      await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(bearer(generateTokenPair(leader.userId, 'student').accessToken));

      await Group.updateOne(
        { groupId: group.groupId },
        { $set: { advisorStatus: 'assigned', professorId: professor.userId } }
      );

      await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(generateTokenPair(coord.userId, 'coordinator').accessToken))
        .send({ targetProfessorId: targetProfessor.userId });

      // Flow group ends as transferred with a professor — it is not a sanitization candidate.
      // Seed disposable groups so sanitization emits `group_disbanded` audit entries.
      await createGroupDoc({ groupName: uid('audit_disband_a'), advisorStatus: 'released', professorId: null });
      await createGroupDoc({ groupName: uid('audit_disband_b'), advisorStatus: 'pending', professorId: null });

      await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(generateTokenPair(coord.userId, 'coordinator').accessToken))
        .send();

      const actions = await AuditLog.find({}, { action: 1, _id: 0 }).lean();
      const actionSet = new Set(actions.map((a) => a.action));
      expect(actionSet.has('advisor_request_submitted')).toBe(true);
      expect(actionSet.has('advisor_rejected')).toBe(true);
      expect(actionSet.has('advisor_released')).toBe(true);
      expect(actionSet.has('advisor_transferred')).toBe(true);
      expect(actionSet.has('group_disbanded')).toBe(true);

      const submitted = await AuditLog.findOne({ action: 'advisor_request_submitted' }).lean();
      expect(submitted.actorId).toBe(leader.userId);
      expect(submitted.targetId).toBe(pendingReq.requestId);
      expect(submitted.payload).toMatchObject({
        requestId: pendingReq.requestId,
        groupId: group.groupId,
        professorId: professor.userId,
      });
    });
  });

  describe('f14 disband notice notification dispatch', () => {
    it('calls dispatchGroupDisbandNotification for each disbanded group', async () => {
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);
      const g1 = await createGroupDoc({ advisorStatus: 'released', professorId: null });
      const g2 = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const safe = await createGroupDoc({ advisorStatus: 'assigned', professorId: 'usr_prof_safe_f14' });
      const spy = jest.spyOn(notificationService, 'dispatchGroupDisbandNotification');
      const coord = await createUser({ userId: 'usr_coord_f14', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ groupId: g1.groupId }));
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ groupId: g2.groupId }));
      expect(res.body.disbandedGroups).not.toContain(safe.groupId);
    });
  });

  describe('f05 decision and transfer notification payloads', () => {
    it('calls dispatchAdvisorDecisionNotification with approve payload', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_f05_a', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });
      const spy = jest.spyOn(notificationService, 'dispatchAdvisorDecisionNotification');

      await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(generateTokenPair(professor.userId, 'professor').accessToken))
        .send({ decision: 'approve' });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: group.groupId,
          professorId: professor.userId,
          decision: 'approve',
        })
      );
    });

    it('calls dispatchAdvisorDecisionNotification with reject payload', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_f05_r', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });
      const spy = jest.spyOn(notificationService, 'dispatchAdvisorDecisionNotification');

      await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(generateTokenPair(professor.userId, 'professor').accessToken))
        .send({ decision: 'reject' });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: group.groupId,
          professorId: professor.userId,
          decision: 'reject',
        })
      );
    });

    it('calls dispatchAdvisorTransferNotification with transfer payload', async () => {
      await openAdvisorWindow(OT.ADVISOR_TRANSFER);
      const oldProfessor = await createUser({ userId: 'usr_prof_old_f05', role: 'professor' });
      const newProfessor = await createUser({ userId: 'usr_prof_new_f05', role: 'professor' });
      const coord = await createUser({ userId: 'usr_coord_f05', role: 'coordinator' });
      const group = await createGroupDoc({
        advisorStatus: 'assigned',
        professorId: oldProfessor.userId,
      });
      const spy = jest.spyOn(notificationService, 'dispatchAdvisorTransferNotification');

      await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(bearer(generateTokenPair(coord.userId, 'coordinator').accessToken))
        .send({ targetProfessorId: newProfessor.userId });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: group.groupId,
          oldProfessorId: oldProfessor.userId,
          newProfessorId: newProfessor.userId,
        })
      );
    });
  });

  describe('f09 advisor assignment status response shape', () => {
    it('approve response includes assignedGroupId, advisorStatus=assigned and professorId', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_f09', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: 'usr_leader',
      });

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(generateTokenPair(professor.userId, 'professor').accessToken))
        .send({ decision: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          assignedGroupId: group.groupId,
          advisorStatus: 'assigned',
          professorId: professor.userId,
        })
      );
    });
  });

  describe('f15 sanitization trigger actors', () => {
    it('allows system actor to trigger sanitization and returns 200', async () => {
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);
      await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const token = generateTokenPair('usr_system', 'system').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
    });

    it('allows coordinator actor to trigger sanitization and returns 200', async () => {
      await openAdvisorWindow(OT.ADVISOR_SANITIZATION);
      await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const coord = await createUser({ userId: 'usr_coord_f15', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
    });
  });
});
