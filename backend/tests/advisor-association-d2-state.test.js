/**
 * Advisor Association Endpoints & D2 State — Contract Tests (Issue #75)
 *
 * This test file adheres to strict contract testing principles:
 * 1. NO Brute-Force Discovery: Controllers are NOT dynamically searched or merged.
 * 2. Static Route Testing: Uses supertest(app) to verify explicit API endpoints.
 * 3. Contract Enforcement: If the route is missing or renamed, tests fail immediately (404).
 *
 * Verifies:
 *  - POST   /api/v1/advisor-requests
 *  - PATCH  /api/v1/advisor-requests/{requestId}
 *  - DELETE /api/v1/groups/{groupId}/advisor
 *  - POST   /api/v1/groups/{groupId}/advisor/transfer
 *  - POST   /api/v1/groups/advisor-sanitization
 */

'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/index'); // Central entry point, enforcing static route definitions
const notificationService = require('../src/services/notificationService');
const { generateAccessToken } = require('../src/utils/jwt');
const { ADVISOR_ASSOCIATION } = require('../src/utils/operationTypes');

// Explicit mocks for services
jest.mock('../src/services/notificationService', () => ({
  dispatchAdvisorRequestNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_req_001' }),
  dispatchAdvisorDecisionNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_dec_001' }),
  dispatchAdvisorTransferNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_advisor_transfer_001' }),
  dispatchGroupDisbandNotification: jest.fn().mockResolvedValue({ notification_id: 'notif_disband_001' }),
}));

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-advisor-association-contract';

const uid = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let User;
let AuditLog;

/**
 * Helper to generate valid Auth headers for different roles.
 * This tests the RBAC layer of the application.
 */
const getAuthHeader = (userId, role) => {
  const token = generateAccessToken(userId, role);
  return { Authorization: `Bearer ${token}` };
};

// ── Database Helpers ─────────────────────────────────────────────────────────

const createUser = async (overrides = {}) =>
  User.create({
    userId: uid('usr'),
    email: `${uid('mail')}@test.edu`,
    hashedPassword: 'hashed',
    accountStatus: 'active',
    role: 'student',
    ...overrides,
  });

const openAdvisorWindow = async (operationType = ADVISOR_ASSOCIATION, overrides = {}) => {
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

const closeAdvisorWindow = async (operationType = ADVISOR_ASSOCIATION) => {
  await mongoose.connection.collection('schedulewindows').deleteMany({ operationType });
};

const createGroupRaw = async (overrides = {}) => {
  const now = new Date();
  const group = {
    groupId: uid('grp'),
    groupName: uid('Group'),
    leaderId: 'usr_leader',
    status: 'active',
    advisorId: null,
    advisorStatus: 'none',
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Issue #75 — Advisor Association Contract Tests', () => {
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
    await Promise.all([
      User.deleteMany({}),
      AuditLog.deleteMany({}),
      mongoose.connection.collection('groups').deleteMany({}),
      mongoose.connection.collection('advisorrequests').deleteMany({}),
      mongoose.connection.collection('schedulewindows').deleteMany({}),
    ]);
    jest.clearAllMocks();
  });

  describe('POST /api/v1/advisor-requests', () => {
    it('returns 201 with requestId and notificationTriggered: true (Contract Check)', async () => {
      await openAdvisorWindow();
      const leader = await createUser({ userId: 'usr_leader', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_1', role: 'professor' });
      const group = await createGroupRaw({ leaderId: leader.userId });

      const response = await request(app)
        .post('/api/v1/advisor-requests')
        .set(getAuthHeader(leader.userId, 'student'))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(response.status).toBe(201);
      expect(response.body.requestId).toBeTruthy();
      expect(response.body.notificationTriggered).toBe(true);
      expect(notificationService.dispatchAdvisorRequestNotification).toHaveBeenCalledTimes(1);
    });

    it('returns 403 for non-leader students (RBAC)', async () => {
      await openAdvisorWindow();
      const professor = await createUser({ userId: 'usr_prof_2', role: 'professor' });
      const group = await createGroupRaw({ leaderId: 'usr_real_leader' });
      const maliciousUser = await createUser({ userId: 'usr_not_leader', role: 'student' });

      const response = await request(app)
        .post('/api/v1/advisor-requests')
        .set(getAuthHeader(maliciousUser.userId, 'student'))
        .send({ groupId: group.groupId, professorId: professor.userId });

      expect(response.status).toBe(403);
    });

    it('returns 409 if group already has an advisor (Conflict)', async () => {
      await openAdvisorWindow();
      const leader = await createUser({ userId: 'usr_leader_conf', role: 'student' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'assigned', professorId: 'usr_p' });

      const response = await request(app)
        .post('/api/v1/advisor-requests')
        .set(getAuthHeader(leader.userId, 'student'))
        .send({ groupId: group.groupId, professorId: 'usr_other_p' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('GROUP_ALREADY_HAS_ADVISOR');
    });

    it('returns 409 if group already has a pending request (Conflict)', async () => {
      await openAdvisorWindow();
      const leader = await createUser({ userId: 'usr_leader_pending', role: 'student' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'pending' });
      await createAdvisorRequestRaw({ groupId: group.groupId, status: 'pending' });

      const response = await request(app)
        .post('/api/v1/advisor-requests')
        .set(getAuthHeader(leader.userId, 'student'))
        .send({ groupId: group.groupId, professorId: 'usr_p' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('DUPLICATE_REQUEST');
    });

    it('returns 422 if outside schedule window (Boundary Check)', async () => {
      await closeAdvisorWindow();
      const leader = await createUser({ userId: 'usr_leader_win', role: 'student' });
      const group = await createGroupRaw({ leaderId: leader.userId });

      const response = await request(app)
        .post('/api/v1/advisor-requests')
        .set(getAuthHeader(leader.userId, 'student'))
        .send({ groupId: group.groupId, professorId: 'usr_p' });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    });
  });

  describe('PATCH /api/v1/advisor-requests/{requestId}', () => {
    it('approves a request and updates D2 state (Atomic Check)', async () => {
      const professor = await createUser({ userId: 'usr_prof_app', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'pending' });
      const reqDoc = await createAdvisorRequestRaw({ groupId: group.groupId, professorId: professor.userId });

      const response = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(getAuthHeader(professor.userId, 'professor'))
        .send({ decision: 'approve' });

      expect(response.status).toBe(200);
      expect(response.body.assignedGroupId).toBe(group.groupId);

      const updatedGroup = await mongoose.connection.collection('groups').findOne({ groupId: group.groupId });
      expect(updatedGroup.advisorStatus).toBe('assigned');
      expect(updatedGroup.professorId).toBe(professor.userId);
    });

    it('returns 409 if request is already processed (Conflict)', async () => {
      const professor = await createUser({ userId: 'usr_prof_app_2', role: 'professor' });
      const reqDoc = await createAdvisorRequestRaw({ professorId: professor.userId, status: 'approved' });

      const response = await request(app)
        .patch(`/api/v1/advisor-requests/${reqDoc.requestId}`)
        .set(getAuthHeader(professor.userId, 'professor'))
        .send({ decision: 'approve' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ALREADY_PROCESSED');
    });
  });

  describe('DELETE /api/v1/groups/{groupId}/advisor', () => {
    it('releases an advisor and updates D2 state (Atomic Check)', async () => {
      const leader = await createUser({ userId: 'usr_leader_rel', role: 'student' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'assigned', professorId: 'usr_prof_rel' });

      const response = await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(getAuthHeader(leader.userId, 'student'))
        .send();

      expect(response.status).toBe(200);
      const updatedGroup = await mongoose.connection.collection('groups').findOne({ groupId: group.groupId });
      expect(updatedGroup.advisorStatus).toBe('none');
      expect(updatedGroup.professorId).toBeNull();
    });

    it('returns 409 if no current advisor is assigned (Conflict)', async () => {
      const leader = await createUser({ userId: 'usr_leader_rel_2', role: 'student' });
      const group = await createGroupRaw({ leaderId: leader.userId, advisorStatus: 'none', professorId: null });

      const response = await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(getAuthHeader(leader.userId, 'student'))
        .send();

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('NO_ADVISOR');
    });
  });

  describe('POST /api/v1/groups/{groupId}/advisor/transfer', () => {
    it('transfers an advisor and updates D2 state (Atomic Check)', async () => {
      const coordinator = await createUser({ userId: 'usr_coord', role: 'coordinator' });
      const newProf = await createUser({ userId: 'usr_prof_new', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'usr_prof_old' });

      const response = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(getAuthHeader(coordinator.userId, 'coordinator'))
        .send({ targetProfessorId: newProf.userId });

      expect(response.status).toBe(200);
      const updatedGroup = await mongoose.connection.collection('groups').findOne({ groupId: group.groupId });
      expect(updatedGroup.professorId).toBe(newProf.userId);
      expect(updatedGroup.advisorStatus).toBe('assigned');
    });

    it('returns 409 if target professor is already the advisor (Conflict)', async () => {
      const coordinator = await createUser({ userId: 'usr_coord_2', role: 'coordinator' });
      const professor = await createUser({ userId: 'usr_prof_x', role: 'professor' });
      const group = await createGroupRaw({ advisorStatus: 'assigned', professorId: professor.userId });

      const response = await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(getAuthHeader(coordinator.userId, 'coordinator'))
        .send({ targetProfessorId: professor.userId });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('TARGET_PROFESSOR_CONFLICT');
    });
  });

  describe('POST /api/v1/groups/advisor-sanitization', () => {
    it('disbands advisor-less groups and returns their IDs (Atomic Check)', async () => {
      const coordinator = await createUser({ userId: 'usr_coord_san', role: 'coordinator' });
      const group1 = await createGroupRaw({ advisorStatus: 'none', status: 'active' });
      const group2 = await createGroupRaw({ advisorStatus: 'assigned', professorId: 'p1', status: 'active' });

      const response = await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(getAuthHeader(coordinator.userId, 'coordinator'))
        .send();

      expect(response.status).toBe(200);
      expect(response.body.disbandedGroups).toContain(group1.groupId);
      expect(response.body.disbandedGroups).not.toContain(group2.groupId);

      const disbandedGroup = await mongoose.connection.collection('groups').findOne({ groupId: group1.groupId });
      expect(disbandedGroup.status).toBe('rejected');
    });
  });

  describe('Audit Trail Contract Assertions', () => {
    it('writes log entries for all advisor-related actions (Integrity Check)', async () => {
      const leader = await createUser({ userId: 'usr_leader_log', role: 'student' });
      const professor = await createUser({ userId: 'usr_prof_log', role: 'professor' });
      const coordinator = await createUser({ userId: 'usr_coord_log', role: 'coordinator' });
      const group = await createGroupRaw({ leaderId: leader.userId });

      // 1. Submit
      await openAdvisorWindow();
      const res1 = await request(app)
        .post('/api/v1/advisor-requests')
        .set(getAuthHeader(leader.userId, 'student'))
        .send({ groupId: group.groupId, professorId: professor.userId });
      const log1 = await AuditLog.findOne({ action: 'advisor_request_submitted' });
      expect(log1).toBeTruthy();

      // 2. Approve
      const res2 = await request(app)
        .patch(`/api/v1/advisor-requests/${res1.body.requestId}`)
        .set(getAuthHeader(professor.userId, 'professor'))
        .send({ decision: 'approve' });
      const log2 = await AuditLog.findOne({ action: 'advisor_approved' });
      expect(log2).toBeTruthy();

      // 3. Transfer
      await request(app)
        .post(`/api/v1/groups/${group.groupId}/advisor/transfer`)
        .set(getAuthHeader(coordinator.userId, 'coordinator'))
        .send({ targetProfessorId: 'usr_prof_transfer' });
      const log3 = await AuditLog.findOne({ action: 'advisor_transferred' });
      expect(log3).toBeTruthy();

      // 4. Release
      await request(app)
        .delete(`/api/v1/groups/${group.groupId}/advisor`)
        .set(getAuthHeader(coordinator.userId, 'coordinator'))
        .send();
      const log4 = await AuditLog.findOne({ action: 'advisor_released' });
      expect(log4).toBeTruthy();

      // 5. Sanitization (Disband)
      await request(app)
        .post('/api/v1/groups/advisor-sanitization')
        .set(getAuthHeader(coordinator.userId, 'coordinator'))
        .send();
      const log5 = await AuditLog.findOne({ action: 'group_disbanded' });
      expect(log5).toBeTruthy();
    });
  });
});
