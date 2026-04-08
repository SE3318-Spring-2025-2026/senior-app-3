/**
 * Advisor Association Endpoints & D2 State — Contract Tests (Issue #75)
 *
 * Red-phase contract tests for:
 *  - POST   /advisor-requests
 *  - PATCH  /advisor-requests/{requestId}
 *  - DELETE /groups/{groupId}/advisor
 *  - POST   /groups/{groupId}/advisor/transfer
 *  - POST   /groups/advisor-sanitization
 *
 * Notes:
 *  - Endpoint implementations are currently absent in backend source.
 *  - These tests intentionally codify required behavior and are expected to fail
 *    until controllers/routes/state-machine/audit hooks are implemented.
 */

'use strict';

const mongoose = require('mongoose');
const notificationService = require('../src/services/notificationService');

jest.mock('../src/services/notificationService', () => ({
  dispatchAdvisorRequestNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_req_001' }),
  dispatchAdvisorDecisionNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_dec_001' }),
  dispatchAdvisorTransferNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_transfer_001' }),
  dispatchGroupDisbandNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_disband_001' }),
}));

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-advisor-association-contract';

const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
  params,
  body,
  user: { userId: 'usr_default', role: 'student', ...userOverrides },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest-integration-test' },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const uid = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let User;
let AuditLog;

const loadAdvisorHandlers = () => {
  const candidates = [
    '../src/controllers/advisorRequests',
    '../src/controllers/advisorAssociation',
    '../src/controllers/advisors',
    '../src/controllers/groups',
  ];

  const merged = {};
  candidates.forEach((p) => {
    try {
      Object.assign(merged, require(p));
    } catch (_) {
      // best effort discovery for contract tests
    }
  });

  return {
    submit: merged.submitAdvisorRequest || merged.createAdvisorRequest,
    decide: merged.processAdvisorRequest || merged.decideAdvisorRequest || merged.updateAdvisorRequest,
    release: merged.releaseAdvisor || merged.removeAdvisorFromGroup,
    transfer: merged.transferAdvisor || merged.transferGroupAdvisor,
    sanitize: merged.runAdvisorSanitization || merged.advisorSanitization || merged.sanitizeAdvisors,
  };
};

const ensureHandler = (name, handler) => {
  if (typeof handler !== 'function') {
    throw new Error(
      `Missing controller handler "${name}". Implement advisor association endpoints to satisfy Issue #75 contract tests.`
    );
  }
};

const createUser = async (overrides = {}) =>
  User.create({
    userId: uid('usr'),
    email: `${uid('mail')}@test.edu`,
    hashedPassword: 'hashed',
    accountStatus: 'active',
    role: 'student',
    ...overrides,
  });

const openAdvisorWindow = async (operationType = 'advisor_association', overrides = {}) => {
  const now = new Date();
  await mongoose.connection.collection('schedulewindows').insertOne({
    windowId: uid('sw'),
    operationType,
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 3_600_000),
    isActive: true,
    createdBy: 'usr_coord',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
};

const createGroupRaw = async (overrides = {}) => {
  const now = new Date();
  const group = {
    groupId: uid('grp'),
    groupName: uid('Group'),
    leaderId: 'usr_leader',
    status: 'active',
    advisorId: null,
    advisorStatus: 'pending',
    professorId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await mongoose.connection.collection('groups').insertOne(group);
  return group;
};

const createAdvisorRequestRaw = async (overrides = {}) => {
  const now = new Date();
  const reqDoc = {
    requestId: uid('arq'),
    groupId: uid('grp'),
    professorId: uid('usr_prof'),
    status: 'pending',
    createdBy: 'usr_leader',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await mongoose.connection.collection('advisorrequests').insertOne(reqDoc);
  return reqDoc;
};

describe('Issue #75 — Advisor Association Endpoints & D2 State (contract)', () => {
  let handlers;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoose.connect(MONGO_URI);
    await mongoose.connection.dropDatabase();

    User = require('../src/models/User');
    AuditLog = require('../src/models/AuditLog');
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    handlers = loadAdvisorHandlers();
    await Promise.all([
      User.deleteMany({}),
      AuditLog.deleteMany({}),
      mongoose.connection.collection('groups').deleteMany({}),
      mongoose.connection.collection('advisorrequests').deleteMany({}),
      mongoose.connection.collection('schedulewindows').deleteMany({}),
    ]);
    jest.clearAllMocks();
  });

  describe('POST /advisor-requests', () => {
    it('returns 201 with requestId and notificationTriggered=true for valid submission', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      await openAdvisorWindow();

      const leader = await createUser({ userId: 'usr_leader', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_1', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.requestId).toBeTruthy();
      expect(body.notificationTriggered).toBe(true);
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: group.groupId, professorId: professor.userId })
      );
    });

    it('returns 403 for non-team-leader', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_2', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_real_leader' });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: 'usr_not_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 when group already has advisor', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_3', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_leader', advisorStatus: 'assigned', professorId: professor.userId });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 409 when group already has pending advisor request', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_4', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_leader' });
      await createAdvisorRequestRaw({ groupId: group.groupId, professorId: professor.userId, status: 'pending' });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 422 when request is out-of-window', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const now = new Date();
      await openAdvisorWindow('advisor_association', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const professor = await createUser({ userId: 'usr_prof_5', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_leader' });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 422 when advisor window is inactive', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      await openAdvisorWindow('advisor_association', { isActive: false });
      const professor = await createUser({ userId: 'usr_prof_5b', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_leader' });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 404 when group is not found', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_6', role: 'professor' });
      const res = makeRes();

      await handlers.submit(
        makeReq({}, { groupId: 'grp_missing', professorId: professor.userId }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when professor is not found', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const group = await createGroupRaw({ leaderId: 'usr_leader' });
      const res = makeRes();

      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: 'usr_prof_missing' }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /advisor-requests/{requestId}', () => {
    it('approve returns 200 and assignedGroupId', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');
      const professor = await createUser({ userId: 'usr_prof_dec_1', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending' });
      const reqDoc = await createAdvisorRequestRaw({ groupId: group.groupId, professorId: professor.userId, status: 'pending' });

      const res = makeRes();
      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'approve' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.assignedGroupId).toBe(group.groupId);
    });

    it('reject returns 200', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');
      const professor = await createUser({ userId: 'usr_prof_dec_2', role: 'professor' });
      const reqDoc = await createAdvisorRequestRaw({ professorId: professor.userId, status: 'pending' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'reject' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 403 for non-professor actor', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const reqDoc = await createAdvisorRequestRaw({ status: 'pending' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'approve' }, { userId: 'usr_student', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 when request already processed', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const professor = await createUser({ userId: 'usr_prof_dec_3', role: 'professor' });
      const reqDoc = await createAdvisorRequestRaw({ professorId: professor.userId, status: 'approved' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'approve' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 422 when out-of-window', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const now = new Date();
      await openAdvisorWindow('advisor_decision', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const professor = await createUser({ userId: 'usr_prof_dec_4', role: 'professor' });
      const reqDoc = await createAdvisorRequestRaw({ professorId: professor.userId, status: 'pending' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'approve' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 404 when request is not found', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const professor = await createUser({ userId: 'usr_prof_dec_5', role: 'professor' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: 'arq_missing' }, { decision: 'approve' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('DELETE /groups/{groupId}/advisor', () => {
    it('valid release returns 200 and sets D2 state to released', async () => {
      ensureHandler('releaseAdvisor', handlers.release);
      await openAdvisorWindow('advisor_release');
      const group = await createGroupRaw({ leaderId: 'usr_leader', advisorStatus: 'assigned', professorId: 'usr_prof_rel_1' });
      const res = makeRes();

      await handlers.release(
        makeReq({ groupId: group.groupId }, {}, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = await mongoose.connection.collection('groups').findOne({ groupId: group.groupId });
      expect(updated.professorId).toBeNull();
      expect(updated.advisorStatus).toBe('released');
    });

    it('returns 409 when there is no current advisor', async () => {
      ensureHandler('releaseAdvisor', handlers.release);
      const group = await createGroupRaw({ leaderId: 'usr_leader', advisorStatus: 'pending', professorId: null });
      const res = makeRes();

      await handlers.release(
        makeReq({ groupId: group.groupId }, {}, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 403 for non-leader and non-coordinator', async () => {
      ensureHandler('releaseAdvisor', handlers.release);
      const group = await createGroupRaw({ leaderId: 'usr_leader', advisorStatus: 'assigned', professorId: 'usr_prof_rel_2' });
      const res = makeRes();

      await handlers.release(
        makeReq({ groupId: group.groupId }, {}, { userId: 'usr_random', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 422 when out-of-window', async () => {
      ensureHandler('releaseAdvisor', handlers.release);
      const now = new Date();
      await openAdvisorWindow('advisor_release', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const group = await createGroupRaw({ leaderId: 'usr_leader', advisorStatus: 'assigned', professorId: 'usr_prof_rel_3' });
      const res = makeRes();

      await handlers.release(
        makeReq({ groupId: group.groupId }, {}, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 404 when group is not found', async () => {
      ensureHandler('releaseAdvisor', handlers.release);
      const res = makeRes();

      await handlers.release(
        makeReq({ groupId: 'grp_missing' }, {}, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /groups/{groupId}/advisor/transfer', () => {
    it('valid transfer returns 200 and updates D2 state to transferred', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      await openAdvisorWindow('advisor_transfer');
      const oldProfessor = await createUser({ userId: 'usr_prof_old', role: 'professor' });
      const newProfessor = await createUser({ userId: 'usr_prof_new', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: oldProfessor.userId });
      const res = makeRes();

      await handlers.transfer(
        makeReq({ groupId: group.groupId }, { targetProfessorId: newProfessor.userId }, { userId: 'usr_coord', role: 'coordinator' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = await mongoose.connection.collection('groups').findOne({ groupId: group.groupId });
      expect(updated.professorId).toBe(newProfessor.userId);
      expect(updated.advisorStatus).toBe('transferred');
    });

    it('returns 403 for non-coordinator', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_current' });
      const res = makeRes();

      await handlers.transfer(
        makeReq({ groupId: group.groupId }, { targetProfessorId: 'usr_prof_target' }, { userId: 'usr_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 when target professor has conflict', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      const target = await createUser({ userId: 'usr_prof_conflict', role: 'professor' });
      await createGroupRaw({ advisorStatus: 'assigned', professorId: target.userId });
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_other' });
      const res = makeRes();

      await handlers.transfer(
        makeReq({ groupId: group.groupId }, { targetProfessorId: target.userId }, { userId: 'usr_coord', role: 'coordinator' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 422 when out-of-window', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      const now = new Date();
      await openAdvisorWindow('advisor_transfer', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_current_2' });
      const res = makeRes();

      await handlers.transfer(
        makeReq({ groupId: group.groupId }, { targetProfessorId: 'usr_prof_target_2' }, { userId: 'usr_coord', role: 'coordinator' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 404 when group is not found', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      const res = makeRes();

      await handlers.transfer(
        makeReq({ groupId: 'grp_missing' }, { targetProfessorId: 'usr_prof_target_3' }, { userId: 'usr_coord', role: 'coordinator' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when target professor is not found', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_current_3' });
      const res = makeRes();

      await handlers.transfer(
        makeReq(
          { groupId: group.groupId },
          { targetProfessorId: 'usr_prof_nonexistent' },
          { userId: 'usr_coord', role: 'coordinator' }
        ),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /groups/advisor-sanitization', () => {
    it('returns 409 before deadline', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      const now = new Date();
      await openAdvisorWindow('advisor_sanitization', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const res = makeRes();

      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord', role: 'coordinator' }), res);
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 403 for non-coordinator and non-system actor', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      const res = makeRes();

      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_student', role: 'student' }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 200 with disbandedGroups[] for valid execution', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');
      const g1 = await createGroupRaw({ advisorStatus: 'released', professorId: null });
      const g2 = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_safe' });
      const res = makeRes();

      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord', role: 'coordinator' }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(Array.isArray(body.disbandedGroups)).toBe(true);
      expect(body.disbandedGroups).toEqual(expect.arrayContaining([g1.groupId, g2.groupId]));
    });

    it('disbands pending advisor-less groups at minimum (contract floor)', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');
      const pendingGroup = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_safe_2' });
      const res = makeRes();

      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord', role: 'coordinator' }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.disbandedGroups).toEqual(expect.arrayContaining([pendingGroup.groupId]));
    });
  });

  describe('D2 state transitions + audit trail assertions', () => {
    it('approve transition sets advisorStatus=assigned and creates advisor_approved audit log', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const professor = await createUser({ userId: 'usr_prof_d2_1', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({ groupId: group.groupId, professorId: professor.userId, status: 'pending' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'approve' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = await mongoose.connection.collection('groups').findOne({ groupId: group.groupId });
      expect(updated.advisorStatus).toBe('assigned');
      expect(updated.professorId).toBe(professor.userId);
      const log = await mongoose.connection.collection('auditlogs').findOne({ action: 'advisor_approved', groupId: group.groupId });
      expect(log).not.toBeNull();
    });

    it('request submission/reject/release/transfer/disband write required audit actions', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      ensureHandler('processAdvisorRequest', handlers.decide);
      ensureHandler('releaseAdvisor', handlers.release);
      ensureHandler('transferAdvisor', handlers.transfer);
      ensureHandler('advisorSanitization', handlers.sanitize);

      const leader = await createUser({ userId: 'usr_leader_audit', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_audit', role: 'professor' });
      const targetProfessor = await createUser({ userId: 'usr_prof_audit_2', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });
      await openAdvisorWindow('advisor_association');
      await openAdvisorWindow('advisor_decision');
      await openAdvisorWindow('advisor_release');
      await openAdvisorWindow('advisor_transfer');
      await openAdvisorWindow('advisor_sanitization');

      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        makeRes()
      );

      const pendingReq = await mongoose.connection.collection('advisorrequests').findOne({ groupId: group.groupId });
      expect(pendingReq).not.toBeNull();
      await handlers.decide(
        makeReq({ requestId: pendingReq.requestId }, { decision: 'reject' }, { userId: professor.userId, role: 'professor' }),
        makeRes()
      );

      await mongoose.connection.collection('groups').updateOne(
        { groupId: group.groupId },
        { $set: { advisorStatus: 'assigned', professorId: professor.userId } }
      );
      await handlers.release(makeReq({ groupId: group.groupId }, {}, { userId: leader.userId, role: 'student' }), makeRes());
      await mongoose.connection.collection('groups').updateOne(
        { groupId: group.groupId },
        { $set: { advisorStatus: 'assigned', professorId: professor.userId } }
      );
      await handlers.transfer(
        makeReq({ groupId: group.groupId }, { targetProfessorId: targetProfessor.userId }, { userId: 'usr_coord', role: 'coordinator' }),
        makeRes()
      );
      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord', role: 'coordinator' }), makeRes());

      const actions = await mongoose.connection.collection('auditlogs').find({}, { projection: { action: 1, _id: 0 } }).toArray();
      const actionSet = new Set(actions.map((a) => a.action));
      expect(actionSet.has('advisor_request_submitted')).toBe(true);
      expect(actionSet.has('advisor_rejected')).toBe(true);
      expect(actionSet.has('advisor_released')).toBe(true);
      expect(actionSet.has('advisor_transferred')).toBe(true);
      expect(actionSet.has('group_disbanded')).toBe(true);
    });
  });

  // Boşluk 1 — f14 disband notice
  describe('f14 disband notice notification dispatch', () => {
    it('calls dispatchGroupDisbandNotification for each disbanded group', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');
      const g1 = await createGroupRaw({ advisorStatus: 'released', professorId: null });
      const g2 = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const safe = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_safe_f14' });
      const res = makeRes();

      await handlers.sanitize(
        makeReq({}, {}, { userId: 'usr_coord_f14', role: 'coordinator' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledTimes(2);
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: g1.groupId })
      );
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: g2.groupId })
      );
      expect(body.disbandedGroups).not.toContain(safe.groupId);
    });
  });

  // Boşluk 2 — f05 notification payload (decision + transfer)
  describe('f05 decision and transfer notification payloads', () => {
    it('calls dispatchAdvisorDecisionNotification with approve payload', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');
      const professor = await createUser({ userId: 'usr_prof_f05_a', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
      });

      await handlers.decide(
        makeReq(
          { requestId: reqDoc.requestId },
          { decision: 'approve' },
          { userId: professor.userId, role: 'professor' }
        ),
        makeRes()
      );

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: group.groupId,
          professorId: professor.userId,
          decision: 'approve',
        })
      );
    });

    it('calls dispatchAdvisorDecisionNotification with reject payload', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');
      const professor = await createUser({ userId: 'usr_prof_f05_r', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
      });

      await handlers.decide(
        makeReq(
          { requestId: reqDoc.requestId },
          { decision: 'reject' },
          { userId: professor.userId, role: 'professor' }
        ),
        makeRes()
      );

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: group.groupId,
          professorId: professor.userId,
          decision: 'reject',
        })
      );
    });

    it('calls dispatchAdvisorTransferNotification with transfer payload', async () => {
      ensureHandler('transferAdvisor', handlers.transfer);
      await openAdvisorWindow('advisor_transfer');
      const oldProfessor = await createUser({ userId: 'usr_prof_old_f05', role: 'professor' });
      const newProfessor = await createUser({ userId: 'usr_prof_new_f05', role: 'professor' });
      const group = await createGroupRaw({
        advisorStatus: 'assigned',
        professorId: oldProfessor.userId,
      });

      await handlers.transfer(
        makeReq(
          { groupId: group.groupId },
          { targetProfessorId: newProfessor.userId },
          { userId: 'usr_coord_f05', role: 'coordinator' }
        ),
        makeRes()
      );

      expect(notificationService.dispatchAdvisorTransferNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: group.groupId,
          oldProfessorId: oldProfessor.userId,
          newProfessorId: newProfessor.userId,
        })
      );
    });
  });

  // Boşluk 3 — f09 advisor assignment status → student
  describe('f09 advisor assignment status response shape', () => {
    it('approve response includes assignedGroupId, advisorStatus=assigned and professorId', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');
      const professor = await createUser({ userId: 'usr_prof_f09', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
      });
      const res = makeRes();

      await handlers.decide(
        makeReq(
          { requestId: reqDoc.requestId },
          { decision: 'approve' },
          { userId: professor.userId, role: 'professor' }
        ),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body).toEqual(
        expect.objectContaining({
          assignedGroupId: group.groupId,
          advisorStatus: 'assigned',
          professorId: professor.userId,
        })
      );
    });
  });

  // Boşluk 4 — f15 sanitization system actor
  describe('f15 sanitization trigger actors', () => {
    it('allows system actor to trigger sanitization and returns 200', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');
      await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const res = makeRes();

      await handlers.sanitize(
        makeReq({}, {}, { userId: 'usr_system', role: 'system' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('allows coordinator actor to trigger sanitization and returns 200', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');
      await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const res = makeRes();

      await handlers.sanitize(
        makeReq({}, {}, { userId: 'usr_coord_f15', role: 'coordinator' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
