/**
 * Notification Service Integration for Advisor Association (Issue #76)
 *
 * HTTP contract tests via supertest — exercises Express routing, auth middleware,
 * schedule windows, and notification dispatch (mocked).
 */

'use strict';

jest.mock('../src/services/notificationService', () => ({
  dispatchAdvisorRequestNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_req_001' }),
  dispatchAdvisorDecisionNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_dec_001' }),
  dispatchAdvisorTransferNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_transfer_001' }),
  dispatchGroupDisbandNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_disband_001' }),
  dispatchDisbandNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_disband_001' }),
}));

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-advisor-notification-integration';
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
    userId: overrides.userId || uid('usr'),
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

/** Advisor association deadline has passed — required for POST /groups/advisor-sanitization */
const seedAdvisorAssociationDeadlineElapsed = async () => {
  await ScheduleWindow.deleteMany({ operationType: OT.ADVISOR_ASSOCIATION });
  const end = new Date(Date.now() - 30_000);
  await ScheduleWindow.create({
    windowId: uid('sw_deadline'),
    operationType: OT.ADVISOR_ASSOCIATION,
    startsAt: new Date(end.getTime() - 86_400_000),
    endsAt: end,
    isActive: true,
    createdBy: 'usr_coord_deadline',
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
    members: overrides.members ?? [],
    ...overrides,
  });
};

describe('Issue #76 — Notification Service Integration for Advisor Association', () => {
  let consoleErrorSpy;

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
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([
      User.deleteMany({}),
      AuditLog.deleteMany({}),
      Group.deleteMany({}),
      AdvisorRequest.deleteMany({}),
      ScheduleWindow.deleteMany({}),
    ]);
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('POST /api/v1/advisor-requests (advisee_request)', () => {
    it('returns 201 and notificationTriggered=true when advisee_request dispatch succeeds', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);

      const leader = await createUser({ userId: 'usr_leader_req_ok', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_ok', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
      });
      const token = generateTokenPair(leader.userId, 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(201);
      expect(res.body.requestId).toEqual(expect.any(String));
      expect(res.body.notificationTriggered).toBe(true);
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'advisee_request',
          professorId: professor.userId,
          groupId: group.groupId,
          teamLeaderId: leader.userId,
        })
      );
    });

    it('retries transient notification failures and succeeds on third attempt with notificationTriggered=true', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);

      const leader = await createUser({ userId: 'usr_leader_req_retry', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_retry', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
      });
      const token = generateTokenPair(leader.userId, 'student').accessToken;

      notificationService.dispatchAdvisorRequestNotification
        .mockRejectedValueOnce(new Error('Notification transient timeout 1'))
        .mockRejectedValueOnce(new Error('Notification transient timeout 2'))
        .mockResolvedValueOnce({ notification_id: 'notif_advisor_req_retry_ok' });

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toBe(201);
      expect(res.body.notificationTriggered).toBe(true);
    });

    it('on permanent notification failure returns 201 with notificationTriggered=false (no retry storm)', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);

      const leader = await createUser({ userId: 'usr_leader_req_soft_fail', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_soft_fail', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
      });
      const token = generateTokenPair(leader.userId, 'student').accessToken;

      const permanentErr = new Error('Notification client error');
      permanentErr.response = { status: 400 };
      notificationService.dispatchAdvisorRequestNotification.mockRejectedValue(permanentErr);

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(201);
      expect(res.body.notificationTriggered).toBe(false);
      expect(res.body.requestId).toEqual(expect.any(String));
    });

    it('returns 201 with notificationTriggered=false when transient retries are exhausted (fail x3)', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);

      const leader = await createUser({ userId: 'usr_leader_req_hard_fail', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_hard_fail', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
      });
      const token = generateTokenPair(leader.userId, 'student').accessToken;

      notificationService.dispatchAdvisorRequestNotification
        .mockRejectedValueOnce(new Error('Notification timeout #1'))
        .mockRejectedValueOnce(new Error('Notification timeout #2'))
        .mockRejectedValueOnce(new Error('Notification timeout #3'));

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toBe(201);
      expect(res.body.notificationTriggered).toBe(false);
    });

    it('returns 403 for non-team-leader', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_req_403', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_real_leader' });
      const token = generateTokenPair('usr_not_leader', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(res.status).toBe(403);
    });

    it('returns 409 when group already has advisor or active pending request', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_req_409', role: 'professor' });
      const assignedGroup = await createGroupDoc({
        leaderId: 'usr_leader_assigned',
        advisorStatus: 'assigned',
        professorId: professor.userId,
      });
      const pendingGroup = await createGroupDoc({ leaderId: 'usr_leader_pending', advisorStatus: 'pending' });
      await AdvisorRequest.create({
        groupId: pendingGroup.groupId,
        professorId: professor.userId,
        status: 'pending',
        requesterId: pendingGroup.leaderId,
      });

      const leaderAssigned = await createUser({ userId: 'usr_leader_assigned', role: 'student' });
      const leaderPending = await createUser({ userId: 'usr_leader_pending', role: 'student' });
      const tokA = generateTokenPair(leaderAssigned.userId, 'student').accessToken;
      const tokB = generateTokenPair(leaderPending.userId, 'student').accessToken;

      const assignedRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(tokA))
        .send({ groupId: assignedGroup.groupId, professorId: professor.userId });
      expect(assignedRes.status).toBe(409);

      const pendingRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(tokB))
        .send({ groupId: pendingGroup.groupId, professorId: professor.userId });
      expect(pendingRes.status).toBe(409);
    });

    it('returns 422 for out-of-window/inactive window', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const now = new Date();
      const professor = await createUser({ userId: 'usr_prof_req_422', role: 'professor' });
      const groupA = await createGroupDoc({ leaderId: 'usr_leader_out_window' });
      const groupB = await createGroupDoc({ leaderId: 'usr_leader_inactive_window' });
      const leaderA = await createUser({ userId: 'usr_leader_out_window', role: 'student' });
      const leaderB = await createUser({ userId: 'usr_leader_inactive_window', role: 'student' });

      await ScheduleWindow.deleteMany({ operationType: OT.ADVISOR_ASSOCIATION });
      await ScheduleWindow.create({
        windowId: uid('sw_future'),
        operationType: OT.ADVISOR_ASSOCIATION,
        startsAt: new Date(now.getTime() + 60_000),
        endsAt: new Date(now.getTime() + 120_000),
        isActive: true,
        createdBy: 'usr_coord',
      });

      const outRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(generateTokenPair(leaderA.userId, 'student').accessToken))
        .send({ groupId: groupA.groupId, professorId: professor.userId });
      expect(outRes.status).toBe(422);

      await ScheduleWindow.deleteMany({ operationType: OT.ADVISOR_ASSOCIATION });
      await ScheduleWindow.create({
        windowId: uid('sw_inactive'),
        operationType: OT.ADVISOR_ASSOCIATION,
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 3_600_000),
        isActive: false,
        createdBy: 'usr_coord',
      });

      const inactiveRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(generateTokenPair(leaderB.userId, 'student').accessToken))
        .send({ groupId: groupB.groupId, professorId: professor.userId });
      expect(inactiveRes.status).toBe(422);
    });

    it('returns 404 when group or professor is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      const professor = await createUser({ userId: 'usr_prof_req_404', role: 'professor' });
      const group = await createGroupDoc({ leaderId: 'usr_leader_404' });
      const leader = await createUser({ userId: 'usr_leader_404', role: 'student' });
      const token = generateTokenPair(leader.userId, 'student').accessToken;

      const missingGroupRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: 'grp_missing', professorId: professor.userId });
      expect(missingGroupRes.status).toBe(404);

      const missingProfRes = await request(app)
        .post('/api/v1/advisor-requests')
        .set(bearer(token))
        .send({ groupId: group.groupId, professorId: 'usr_prof_missing' });
      expect(missingProfRes.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/advisor-requests/:requestId (decision: reject)', () => {
    it('dispatches rejection_notice to team leader with required payload fields', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);

      const leader = await createUser({ userId: 'usr_leader_reject_ok', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_reject_ok', role: 'professor' });
      const group = await createGroupDoc({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        requesterId: leader.userId,
      });
      const reason = 'Research area mismatch';
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject', reason });

      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(true);
      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'rejection_notice',
          groupId: group.groupId,
          requestId: reqDoc.requestId,
          professorId: professor.userId,
          reason,
          teamLeaderId: leader.userId,
          decision: 'reject',
        })
      );
    });

    it('retries reject notification dispatch on transient failures and succeeds within 3 attempts', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);

      const professor = await createUser({ userId: 'usr_prof_reject_retry', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        requesterId: group.leaderId,
      });

      notificationService.dispatchAdvisorDecisionNotification
        .mockRejectedValueOnce(new Error('Reject notification timeout #1'))
        .mockRejectedValueOnce(new Error('Reject notification timeout #2'))
        .mockResolvedValueOnce({ notification_id: 'notif_reject_retry_ok' });

      const token = generateTokenPair(professor.userId, 'professor').accessToken;
      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject', reason: 'Load limit' });

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(true);
    });

    it('returns 200 with notificationTriggered=false when reject notification retries are exhausted', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);

      const professor = await createUser({ userId: 'usr_prof_reject_fail', role: 'professor' });
      const group = await createGroupDoc({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        requesterId: group.leaderId,
      });

      notificationService.dispatchAdvisorDecisionNotification
        .mockRejectedValueOnce(new Error('Reject notification failed #1'))
        .mockRejectedValueOnce(new Error('Reject notification failed #2'))
        .mockRejectedValueOnce(new Error('Reject notification failed #3'));

      const token = generateTokenPair(professor.userId, 'professor').accessToken;
      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject', reason: 'Out of quota' });

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(false);
    });

    it('returns 403 for non-professor', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const reqDoc = await AdvisorRequest.create({
        groupId: 'grp_x',
        professorId: 'usr_prof_x',
        status: 'pending',
        requesterId: 'usr_leader_x',
      });
      const token = generateTokenPair('usr_student_actor', 'student').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject' });

      expect(res.status).toBe(403);
    });

    it('returns 409 when request already processed', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_reject_409', role: 'professor' });
      await createGroupDoc({
        groupId: 'grp_rej_409',
        leaderId: 'usr_l_409',
        advisorStatus: 'pending',
      });
      const reqDoc = await AdvisorRequest.create({
        professorId: professor.userId,
        status: 'approved',
        groupId: 'grp_rej_409',
        requesterId: 'usr_l',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject' });

      expect(res.status).toBe(409);
    });

    it('returns 422 when decision window is out-of-range', async () => {
      const now = new Date();
      await ScheduleWindow.create({
        windowId: uid('sw_dec'),
        operationType: OT.ADVISOR_DECISION,
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
        isActive: true,
        createdBy: 'usr_coord',
      });
      const professor = await createUser({ userId: 'usr_prof_reject_422', role: 'professor' });
      await createGroupDoc({
        groupId: 'grp_rej_422',
        leaderId: 'usr_l2',
        advisorStatus: 'pending',
      });
      const reqDoc = await AdvisorRequest.create({
        professorId: professor.userId,
        status: 'pending',
        groupId: 'grp_rej_422',
        requesterId: 'usr_l2',
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'reject' });

      expect(res.status).toBe(422);
    });

    it('returns 404 when request is not found', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);
      const professor = await createUser({ userId: 'usr_prof_reject_404', role: 'professor' });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch('/api/v1/advisor-requests/arq_missing_reject')
        .set(bearer(token))
        .send({ decision: 'reject' });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/advisor-requests/:requestId (decision: approve)', () => {
    it('updates DB, returns 200, and dispatches approval_notice with groupId, requestId, professorId', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);

      const leader = await createUser({ userId: 'usr_leader_appr_ok', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_appr_ok', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
      });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        requesterId: leader.userId,
      });
      const token = generateTokenPair(professor.userId, 'professor').accessToken;

      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve', reason: 'Strong fit' });

      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('approve');
      expect(res.body.notificationTriggered).toBe(true);

      const updated = await Group.findOne({ groupId: group.groupId }).lean();
      expect(updated.advisorStatus).toBe('assigned');
      expect(updated.professorId).toBe(professor.userId);

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval_notice',
          groupId: group.groupId,
          requestId: reqDoc.requestId,
          professorId: professor.userId,
          teamLeaderId: leader.userId,
          decision: 'approve',
        })
      );
    });

    it('returns 200 with notificationTriggered=false when approval notification exhausts retries', async () => {
      await openAdvisorWindow(OT.ADVISOR_DECISION);

      const leader = await createUser({ userId: 'usr_leader_appr_fail', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_appr_fail', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
      });
      const reqDoc = await AdvisorRequest.create({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        requesterId: leader.userId,
      });

      notificationService.dispatchAdvisorDecisionNotification
        .mockRejectedValueOnce(new Error('approve notif 1'))
        .mockRejectedValueOnce(new Error('approve notif 2'))
        .mockRejectedValueOnce(new Error('approve notif 3'));

      const token = generateTokenPair(professor.userId, 'professor').accessToken;
      const res = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(bearer(token))
        .send({ decision: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body.notificationTriggered).toBe(false);
      const updated = await Group.findOne({ groupId: group.groupId }).lean();
      expect(updated.advisorStatus).toBe('assigned');
    });
  });

  describe('POST /api/v1/groups/advisor-sanitization (disband_notice)', () => {
    it('dispatches disband_notice for each disbanded group with strict members (string user ids)', async () => {
      await seedAdvisorAssociationDeadlineElapsed();

      const mem1 = 'usr_mem_1';
      const mem2 = 'usr_mem_2';
      const mem3 = 'usr_mem_3';

      const g1 = await createGroupDoc({
        advisorStatus: 'released',
        professorId: null,
        members: [
          { userId: mem1, status: 'accepted', role: 'member' },
          { userId: mem2, status: 'accepted', role: 'member' },
        ],
      });
      const g2 = await createGroupDoc({
        advisorStatus: 'pending',
        professorId: null,
        members: [{ userId: mem3, status: 'accepted', role: 'member' }],
      });
      await createGroupDoc({
        advisorStatus: 'assigned',
        professorId: 'usr_prof_safe_76',
        advisorId: 'usr_prof_safe_76',
        members: [{ userId: 'usr_mem_safe', status: 'accepted', role: 'member' }],
      });

      const coord = await createUser({ userId: 'usr_coord_sanitize_ok', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(notificationService.dispatchDisbandNotification).toHaveBeenCalledTimes(2);

      expect(notificationService.dispatchDisbandNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'disband_notice',
          groupId: g1.groupId,
          members: expect.arrayContaining([mem1, mem2]),
        })
      );
      expect(notificationService.dispatchDisbandNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'disband_notice',
          groupId: g2.groupId,
          members: expect.arrayContaining([mem3]),
        })
      );

      for (const call of notificationService.dispatchDisbandNotification.mock.calls) {
        const [payload] = call;
        expect(Array.isArray(payload.members)).toBe(true);
        expect(payload.members.every((m) => typeof m === 'string')).toBe(true);
      }
    });

    it('returns 200 with notificationFailures when disband notifications fail after retries', async () => {
      await seedAdvisorAssociationDeadlineElapsed();
      await createGroupDoc({
        advisorStatus: 'pending',
        professorId: null,
        members: [{ userId: 'usr_mem_fail', status: 'accepted', role: 'member' }],
      });

      notificationService.dispatchDisbandNotification
        .mockRejectedValueOnce(new Error('Sanitization disband notification failed #1'))
        .mockRejectedValueOnce(new Error('Sanitization disband notification failed #2'))
        .mockRejectedValueOnce(new Error('Sanitization disband notification failed #3'));

      const coord = await createUser({ userId: 'usr_coord_sanitize_fail', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.disbandedGroups)).toBe(true);
      expect(Array.isArray(res.body.notificationFailures)).toBe(true);
      expect(res.body.notificationFailures.length).toBeGreaterThan(0);
      expect(notificationService.dispatchDisbandNotification).toHaveBeenCalledTimes(3);
    });

    it('returns 403 for non-coordinator and non-system actor', async () => {
      await seedAdvisorAssociationDeadlineElapsed();
      const token = generateTokenPair('usr_student_sanitize_forbidden', 'student').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(403);
    });

    it('returns 409 when sanitization deadline has not passed', async () => {
      await ScheduleWindow.deleteMany({});
      const now = new Date();
      await ScheduleWindow.create({
        windowId: uid('sw_future_deadline'),
        operationType: OT.ADVISOR_ASSOCIATION,
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 120_000),
        isActive: true,
        createdBy: 'usr_coord',
      });
      const coord = await createUser({ userId: 'usr_coord_sanitize_409', role: 'coordinator' });
      const token = generateTokenPair(coord.userId, 'coordinator').accessToken;

      const res = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(token))
        .send();

      expect(res.status).toBe(409);
    });
  });

  describe('Audit log assertions for write paths', () => {
    it('writes expected audit actions for submit + reject + sanitization flows', async () => {
      await openAdvisorWindow(OT.ADVISOR_ASSOCIATION);
      await openAdvisorWindow(OT.ADVISOR_DECISION);

      await createUser({ userId: 'usr_coord_audit_76', role: 'coordinator' });
      const leader = await createUser({ userId: 'usr_leader_audit_76', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_audit_76', role: 'professor' });
      const group = await createGroupDoc({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
        members: [{ userId: leader.userId, status: 'accepted', role: 'leader' }],
      });

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
        .send({ decision: 'reject', reason: 'Audit check reject' });

      await seedAdvisorAssociationDeadlineElapsed();

      await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(bearer(generateTokenPair('usr_coord_audit_76', 'coordinator').accessToken))
        .send();

      const actions = await mongoose.connection.collection('auditlogs').find({}, { projection: { action: 1, _id: 0 } }).toArray();
      const actionSet = new Set(actions.map((a) => a.action));

      expect(actionSet.has('advisor_request_submitted')).toBe(true);
      expect(actionSet.has('advisor_rejected')).toBe(true);
      expect(actionSet.has('group_disbanded')).toBe(true);
    });
  });
});
