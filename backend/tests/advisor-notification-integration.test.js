/**
 * Notification Service Integration for Advisor Association (Issue #76)
 *
 * Coverage notes (Cross-check: feature issues #54-#67):
 * - #56 Notify Advisor (f05 / process 3.3): advisee_request dispatch + payload
 * - #63 Notification Service Integration: retry, failure logging, graceful degradation
 * - #61 Disband Unassigned Groups (f14 / process 3.7): disband_notice per group
 * - Advisor endpoint contract alignment (#69/#70): 403/404/409/422 branches + audit trail
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
  'mongodb://localhost:27017/senior-app-test-advisor-notification-integration';

const makeReq = (params = {}, body = {}, userOverrides = {}) => ({
  params,
  body,
  user: { userId: 'usr_default', role: 'student', ...userOverrides },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest-notification-contract-test' },
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
let SyncErrorLog;

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
    sanitize: merged.runAdvisorSanitization || merged.advisorSanitization || merged.sanitizeAdvisors,
  };
};

const ensureHandler = (name, handler) => {
  if (typeof handler !== 'function') {
    throw new Error(
      `Missing controller handler "${name}". Implement advisor notification integration handlers to satisfy Issue #76 contract tests.`
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
    members: [],
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

describe('Issue #76 — Notification Service Integration for Advisor Association', () => {
  let handlers;
  let consoleErrorSpy;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoose.connect(MONGO_URI);
    await mongoose.connection.dropDatabase();

    User = require('../src/models/User');
    AuditLog = require('../src/models/AuditLog');
    try {
      SyncErrorLog = require('../src/models/SyncErrorLog');
    } catch (_) {
      SyncErrorLog = null;
    }
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    handlers = loadAdvisorHandlers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([
      User.deleteMany({}),
      AuditLog.deleteMany({}),
      mongoose.connection.collection('groups').deleteMany({}),
      mongoose.connection.collection('advisorrequests').deleteMany({}),
      mongoose.connection.collection('schedulewindows').deleteMany({}),
      SyncErrorLog ? SyncErrorLog.deleteMany({}) : Promise.resolve(),
    ]);
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('POST /advisor-requests (advisee_request)', () => {
    it('returns 201 and notificationTriggered=true when advisee_request dispatch succeeds', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      await openAdvisorWindow('advisor_association');

      const leader = await createUser({ userId: 'usr_leader_req_ok', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_ok', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          notificationTriggered: true,
        })
      );
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'advisee_request',
          professorId: professor.userId,
          groupId: group.groupId,
          requesterId: leader.userId,
        })
      );
    });

    it('retries transient notification failures and succeeds on third attempt with notificationTriggered=true', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      await openAdvisorWindow('advisor_association');

      const leader = await createUser({ userId: 'usr_leader_req_retry', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_retry', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });

      notificationService.dispatchAdvisorRequestNotification
        .mockRejectedValueOnce(new Error('Notification transient timeout 1'))
        .mockRejectedValueOnce(new Error('Notification transient timeout 2'))
        .mockResolvedValueOnce({ notification_id: 'notif_advisor_req_retry_ok' });

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        res
      );

      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationTriggered: true,
        })
      );
    });

    it('on notification failure logs error and returns graceful response with notificationTriggered=false', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      await openAdvisorWindow('advisor_association');

      const leader = await createUser({ userId: 'usr_leader_req_soft_fail', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_soft_fail', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });

      notificationService.dispatchAdvisorRequestNotification.mockRejectedValue(new Error('Notification service unavailable'));

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        res
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          notificationTriggered: false,
        })
      );
    });

    it('returns 503 and persists error log when retries are exhausted (fail x3)', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      await openAdvisorWindow('advisor_association');

      const leader = await createUser({ userId: 'usr_leader_req_hard_fail', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_req_hard_fail', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });

      notificationService.dispatchAdvisorRequestNotification
        .mockRejectedValueOnce(new Error('Notification timeout #1'))
        .mockRejectedValueOnce(new Error('Notification timeout #2'))
        .mockRejectedValueOnce(new Error('Notification timeout #3'));

      const res = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        res
      );

      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(3);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);

      if (SyncErrorLog) {
        const syncLogs = await SyncErrorLog.find({ groupId: group.groupId, service: 'notification' });
        expect(syncLogs.length).toBeGreaterThan(0);
      }
    });

    it('returns 403 for non-team-leader', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_req_403', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_real_leader' });
      const res = makeRes();

      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: 'usr_not_leader', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 when group already has advisor or active pending request', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_req_409', role: 'professor' });
      const assignedGroup = await createGroupRaw({
        leaderId: 'usr_leader_assigned',
        advisorStatus: 'assigned',
        professorId: professor.userId,
      });
      const pendingGroup = await createGroupRaw({ leaderId: 'usr_leader_pending', advisorStatus: 'pending' });
      await createAdvisorRequestRaw({
        groupId: pendingGroup.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: pendingGroup.leaderId,
      });

      const assignedRes = makeRes();
      await handlers.submit(
        makeReq(
          {},
          { groupId: assignedGroup.groupId, professorId: professor.userId },
          { userId: assignedGroup.leaderId, role: 'student' }
        ),
        assignedRes
      );
      expect(assignedRes.status).toHaveBeenCalledWith(409);

      const pendingRes = makeRes();
      await handlers.submit(
        makeReq(
          {},
          { groupId: pendingGroup.groupId, professorId: professor.userId },
          { userId: pendingGroup.leaderId, role: 'student' }
        ),
        pendingRes
      );
      expect(pendingRes.status).toHaveBeenCalledWith(409);
    });

    it('returns 422 for out-of-window/inactive window', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const now = new Date();
      const professor = await createUser({ userId: 'usr_prof_req_422', role: 'professor' });
      const groupA = await createGroupRaw({ leaderId: 'usr_leader_out_window' });
      const groupB = await createGroupRaw({ leaderId: 'usr_leader_inactive_window' });

      await openAdvisorWindow('advisor_association', {
        startsAt: new Date(now.getTime() + 60_000),
        endsAt: new Date(now.getTime() + 120_000),
      });
      const outWindowRes = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: groupA.groupId, professorId: professor.userId }, { userId: groupA.leaderId, role: 'student' }),
        outWindowRes
      );
      expect(outWindowRes.status).toHaveBeenCalledWith(422);

      await mongoose.connection.collection('schedulewindows').deleteMany({});
      await openAdvisorWindow('advisor_association', { isActive: false });
      const inactiveRes = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: groupB.groupId, professorId: professor.userId }, { userId: groupB.leaderId, role: 'student' }),
        inactiveRes
      );
      expect(inactiveRes.status).toHaveBeenCalledWith(422);
    });

    it('returns 404 when group or professor is not found', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      const professor = await createUser({ userId: 'usr_prof_req_404', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_leader_404' });

      const missingGroupRes = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: 'grp_missing', professorId: professor.userId }, { userId: group.leaderId, role: 'student' }),
        missingGroupRes
      );
      expect(missingGroupRes.status).toHaveBeenCalledWith(404);

      const missingProfRes = makeRes();
      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: 'usr_prof_missing' }, { userId: group.leaderId, role: 'student' }),
        missingProfRes
      );
      expect(missingProfRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /advisor-requests/{requestId} (decision: reject)', () => {
    it('dispatches rejection_notice to team leader with required payload fields', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');

      const leader = await createUser({ userId: 'usr_leader_reject_ok', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_reject_ok', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
        createdBy: leader.userId,
      });
      const reason = 'Research area mismatch';

      const res = makeRes();
      await handlers.decide(
        makeReq(
          { requestId: reqDoc.requestId },
          { decision: 'reject', reason },
          { userId: professor.userId, role: 'professor' }
        ),
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
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
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');

      const professor = await createUser({ userId: 'usr_prof_reject_retry', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
      });

      notificationService.dispatchAdvisorDecisionNotification
        .mockRejectedValueOnce(new Error('Reject notification timeout #1'))
        .mockRejectedValueOnce(new Error('Reject notification timeout #2'))
        .mockResolvedValueOnce({ notification_id: 'notif_reject_retry_ok' });

      const res = makeRes();
      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'reject', reason: 'Load limit' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 503 and logs error when reject notification retries are exhausted', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      await openAdvisorWindow('advisor_decision');

      const professor = await createUser({ userId: 'usr_prof_reject_fail', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending', professorId: null });
      const reqDoc = await createAdvisorRequestRaw({
        groupId: group.groupId,
        professorId: professor.userId,
        status: 'pending',
      });

      notificationService.dispatchAdvisorDecisionNotification
        .mockRejectedValueOnce(new Error('Reject notification failed #1'))
        .mockRejectedValueOnce(new Error('Reject notification failed #2'))
        .mockRejectedValueOnce(new Error('Reject notification failed #3'));

      const res = makeRes();
      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'reject', reason: 'Out of quota' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(notificationService.dispatchAdvisorDecisionNotification).toHaveBeenCalledTimes(3);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 403 for non-professor', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const reqDoc = await createAdvisorRequestRaw({ status: 'pending' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'reject' }, { userId: 'usr_student_actor', role: 'student' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 when request already processed', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const professor = await createUser({ userId: 'usr_prof_reject_409', role: 'professor' });
      const reqDoc = await createAdvisorRequestRaw({ professorId: professor.userId, status: 'approved' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'reject' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 422 when decision window is out-of-range', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const now = new Date();
      await openAdvisorWindow('advisor_decision', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const professor = await createUser({ userId: 'usr_prof_reject_422', role: 'professor' });
      const reqDoc = await createAdvisorRequestRaw({ professorId: professor.userId, status: 'pending' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: reqDoc.requestId }, { decision: 'reject' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 404 when request is not found', async () => {
      ensureHandler('processAdvisorRequest', handlers.decide);
      const professor = await createUser({ userId: 'usr_prof_reject_404', role: 'professor' });
      const res = makeRes();

      await handlers.decide(
        makeReq({ requestId: 'arq_missing_reject' }, { decision: 'reject' }, { userId: professor.userId, role: 'professor' }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /groups/advisor-sanitization (disband_notice)', () => {
    it('dispatches disband_notice for each disbanded group with groupId and members list', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');

      const g1 = await createGroupRaw({
        advisorStatus: 'released',
        professorId: null,
        members: [{ userId: 'usr_mem_1' }, { userId: 'usr_mem_2' }],
      });
      const g2 = await createGroupRaw({
        advisorStatus: 'pending',
        professorId: null,
        members: [{ userId: 'usr_mem_3' }],
      });
      await createGroupRaw({
        advisorStatus: 'assigned',
        professorId: 'usr_prof_safe_76',
        members: [{ userId: 'usr_mem_safe' }],
      });

      const res = makeRes();
      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord_sanitize_ok', role: 'coordinator' }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledTimes(2);
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'disband_notice',
          groupId: g1.groupId,
          members: expect.any(Array),
        })
      );
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'disband_notice',
          groupId: g2.groupId,
          members: expect.any(Array),
        })
      );
    });

    it('does not silently swallow notification failures during sanitization (logs and surfaces failure)', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_sanitization');
      await createGroupRaw({ advisorStatus: 'pending', professorId: null, members: [{ userId: 'usr_mem_fail' }] });

      notificationService.dispatchGroupDisbandNotification
        .mockRejectedValueOnce(new Error('Sanitization disband notification failed #1'))
        .mockRejectedValueOnce(new Error('Sanitization disband notification failed #2'))
        .mockRejectedValueOnce(new Error('Sanitization disband notification failed #3'));

      const res = makeRes();
      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord_sanitize_fail', role: 'coordinator' }), res);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(notificationService.dispatchGroupDisbandNotification).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 403 for non-coordinator and non-system actor', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      const res = makeRes();

      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_student_sanitize_forbidden', role: 'student' }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 409 when sanitization is triggered before allowed window', async () => {
      ensureHandler('advisorSanitization', handlers.sanitize);
      const now = new Date();
      await openAdvisorWindow('advisor_sanitization', {
        startsAt: new Date(now.getTime() + 120_000),
        endsAt: new Date(now.getTime() + 240_000),
      });
      const res = makeRes();

      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord_sanitize_409', role: 'coordinator' }), res);
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('Audit log assertions for write paths', () => {
    it('writes expected audit actions for submit + reject + sanitization flows', async () => {
      ensureHandler('submitAdvisorRequest', handlers.submit);
      ensureHandler('processAdvisorRequest', handlers.decide);
      ensureHandler('advisorSanitization', handlers.sanitize);
      await openAdvisorWindow('advisor_association');
      await openAdvisorWindow('advisor_decision');
      await openAdvisorWindow('advisor_sanitization');

      const leader = await createUser({ userId: 'usr_leader_audit_76', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_audit_76', role: 'professor' });
      const group = await createGroupRaw({
        leaderId: leader.userId,
        advisorStatus: 'pending',
        professorId: null,
        members: [{ userId: leader.userId }],
      });

      await handlers.submit(
        makeReq({}, { groupId: group.groupId, professorId: professor.userId }, { userId: leader.userId, role: 'student' }),
        makeRes()
      );
      const pendingReq = await mongoose.connection.collection('advisorrequests').findOne({ groupId: group.groupId });
      expect(pendingReq).not.toBeNull();

      await handlers.decide(
        makeReq(
          { requestId: pendingReq.requestId },
          { decision: 'reject', reason: 'Audit check reject' },
          { userId: professor.userId, role: 'professor' }
        ),
        makeRes()
      );
      await handlers.sanitize(makeReq({}, {}, { userId: 'usr_coord_audit_76', role: 'coordinator' }), makeRes());

      const actions = await mongoose.connection.collection('auditlogs').find({}, { projection: { action: 1, _id: 0 } }).toArray();
      const actionSet = new Set(actions.map((a) => a.action));

      expect(actionSet.has('advisor_request_submitted')).toBe(true);
      expect(actionSet.has('advisor_rejected')).toBe(true);
      expect(actionSet.has('group_disbanded')).toBe(true);
    });
  });
});
