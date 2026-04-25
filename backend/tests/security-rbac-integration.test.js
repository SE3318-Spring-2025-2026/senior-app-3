const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const axios = require('axios');

const app = require('../src/index');
const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const Deliverable = require('../src/models/Deliverable');
const Evaluation = require('../src/models/Evaluation');
const SprintConfig = require('../src/models/SprintConfig');
const ContributionRecord = require('../src/models/ContributionRecord');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../src/models/FinalGrade');

describe('Process 8 Security Integration & RBAC Matrix Audit', () => {
  let mongoReplSet;
  let axiosPostSpy;

  const GROUP_ID = 'grp_1';
  const PUBLISH_CYCLE = '2026-Spring';

  const users = {
    coordinator: { userId: 'usr_coordinator', role: 'coordinator' },
    professorAssigned: { userId: 'usr_professor_assigned', role: 'professor' },
    professorUnassigned: { userId: 'usr_professor_unassigned', role: 'professor' },
    advisorAssigned: { userId: 'usr_advisor_assigned', role: 'advisor' },
    advisorUnassigned: { userId: 'usr_advisor_unassigned', role: 'advisor' },
    student: { userId: 'usr_student', role: 'student' }
  };

  const matrixRows = [];

  const tokenFor = (user) => generateAccessToken(user.userId, user.role);

  const trackMatrix = (role, endpoint, expected, actual) => {
    matrixRows.push({
      role,
      endpoint,
      expected,
      actual,
      pass: expected === actual ? 'yes' : 'no'
    });
  };

  const expectStable403 = (response) => {
    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('code');
    expect(typeof response.body.code).toBe('string');
    expect(response.body.code.length).toBeGreaterThan(0);
  };

  const seedPreviewPrerequisites = async () => {
    await Group.create({
      groupId: GROUP_ID,
      groupName: 'RBAC Security Group',
      leaderId: 'leader_1',
      advisorId: users.advisorAssigned.userId,
      professorId: users.professorAssigned.userId,
      status: 'active'
    });

    await SprintConfig.create({
      sprintId: 'sp_1',
      deliverableType: 'final_report',
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      weight: 1,
      configurationStatus: 'published',
      publishedAt: new Date()
    });

    await Deliverable.create({
      deliverableId: 'del_1',
      groupId: GROUP_ID,
      sprintId: 'sp_1',
      submittedBy: users.student.userId,
      deliverableType: 'final_report',
      filePath: '/tmp/final-report.pdf',
      fileSize: 1024,
      fileHash: 'hash_1',
      format: 'pdf',
      status: 'accepted'
    });

    await Evaluation.create({
      evaluationId: 'eval_1',
      deliverableId: 'del_1',
      groupId: GROUP_ID,
      evaluatorId: 'evalr_1',
      score: 88,
      status: 'completed'
    });

    await ContributionRecord.create({
      contributionRecordId: 'ctr_1',
      sprintId: 'sp_1',
      groupId: GROUP_ID,
      studentId: users.student.userId,
      contributionRatio: 1
    });
  };

  const seedPendingGrades = async () => {
    await FinalGrade.create({
      finalGradeId: 'fg_1',
      groupId: GROUP_ID,
      studentId: users.student.userId,
      publishCycle: PUBLISH_CYCLE,
      baseGroupScore: 88,
      individualRatio: 1,
      computedFinalGrade: 88,
      status: FINAL_GRADE_STATUS.PENDING
    });
  };

  const getSystemToken = () => process.env.INTERNAL_SYSTEM_TOKEN || 'internal-system-token-test';

  beforeAll(async () => {
    process.env.INTERNAL_SYSTEM_TOKEN = getSystemToken();
    mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = mongoReplSet.getUri();

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }
    // Pre-create audit collection to avoid first-use catalog change
    // race against transaction-bound approval writes in CI.
    try {
      await mongoose.connection.createCollection('auditlogs');
    } catch (_error) {
      // Ignore already-exists style startup races.
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });

  afterAll(async () => {
    if (matrixRows.length > 0) {
      console.log('\n=== RBAC Access Matrix (Role vs Endpoint) ===');
      console.table(matrixRows);
    }
    await mongoose.disconnect();
    await mongoReplSet.stop();
  });

  it('8.1-8.2 Preview: coordinator and assigned professor/advisor can preview, unassigned and student are forbidden with exact spec code+message', async () => {
    await seedPreviewPrerequisites();

    const coordinatorResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
      .set('Authorization', `Bearer ${tokenFor(users.coordinator)}`)
      .send({ requestedBy: users.coordinator.userId, useLatestRatios: false });
    trackMatrix('coordinator', 'POST /groups/{groupId}/final-grades/preview', 200, coordinatorResponse.status);
    expect(coordinatorResponse.status).toBe(200);

    const assignedProfessorResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
      .set('Authorization', `Bearer ${tokenFor(users.professorAssigned)}`)
      .send({ requestedBy: users.professorAssigned.userId, useLatestRatios: false });
    trackMatrix('professor(assigned)', 'POST /groups/{groupId}/final-grades/preview', 200, assignedProfessorResponse.status);
    expect(assignedProfessorResponse.status).toBe(200);

    const assignedAdvisorResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
      .set('Authorization', `Bearer ${tokenFor(users.advisorAssigned)}`)
      .send({ requestedBy: users.advisorAssigned.userId, useLatestRatios: false });
    trackMatrix('advisor(assigned)', 'POST /groups/{groupId}/final-grades/preview', 200, assignedAdvisorResponse.status);
    expect(assignedAdvisorResponse.status).toBe(200);

    const unassignedProfessorResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
      .set('Authorization', `Bearer ${tokenFor(users.professorUnassigned)}`)
      .send({ requestedBy: users.professorUnassigned.userId, useLatestRatios: false });
    trackMatrix('professor(unassigned)', 'POST /groups/{groupId}/final-grades/preview', 403, unassignedProfessorResponse.status);
    expectStable403(unassignedProfessorResponse);
    expect(unassignedProfessorResponse.body.code).toBe('FORBIDDEN_PREVIEW_ACCESS');
    expect(unassignedProfessorResponse.body.error).toBe(
      'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades'
    );

    const unassignedAdvisorResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
      .set('Authorization', `Bearer ${tokenFor(users.advisorUnassigned)}`)
      .send({ requestedBy: users.advisorUnassigned.userId, useLatestRatios: false });
    trackMatrix('advisor(unassigned)', 'POST /groups/{groupId}/final-grades/preview', 403, unassignedAdvisorResponse.status);
    expectStable403(unassignedAdvisorResponse);
    expect(unassignedAdvisorResponse.body.code).toBe('FORBIDDEN_PREVIEW_ACCESS');
    expect(unassignedAdvisorResponse.body.error).toBe(
      'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades'
    );

    const studentResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
      .set('Authorization', `Bearer ${tokenFor(users.student)}`)
      .send({ requestedBy: users.student.userId, useLatestRatios: false });
    trackMatrix('student', 'POST /groups/{groupId}/final-grades/preview', 403, studentResponse.status);
    expectStable403(studentResponse);
    expect(studentResponse.body.code).toBe('FORBIDDEN_PREVIEW_ACCESS');
    expect(studentResponse.body.error).toBe(
      'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades'
    );
  });

  it('8.4 Approval: only coordinator is allowed; all other roles are forbidden with exact OpenAPI message', async () => {
    await seedPendingGrades();

    const coordinatorResponse = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/approve`)
      .set('Authorization', `Bearer ${tokenFor(users.coordinator)}`)
      .send({
        publishCycle: PUBLISH_CYCLE,
        decision: 'approve',
        reason: 'security-rbac-test'
      });
    trackMatrix('coordinator', 'POST /groups/{groupId}/final-grades/approve', 200, coordinatorResponse.status);
    expect(coordinatorResponse.status).toBe(200);

    const disallowedUsers = [
      users.professorAssigned,
      users.professorUnassigned,
      users.student
    ];

    for (const user of disallowedUsers) {
      const response = await request(app)
        .post(`/api/v1/groups/${GROUP_ID}/final-grades/approve`)
        .set('Authorization', `Bearer ${tokenFor(user)}`)
        .send({
          publishCycle: PUBLISH_CYCLE,
          decision: 'approve',
          reason: 'security-rbac-test'
        });

      trackMatrix(`${user.role}:${user.userId}`, 'POST /groups/{groupId}/final-grades/approve', 403, response.status);
      expectStable403(response);
      expect(response.body.error).toBe(
        'Forbidden - only the Coordinator role may approve final grades'
      );
      expect(response.body.code).toBe('UNAUTHORIZED_ROLE');
    }
  });

  it('8.5 Publish: non-coordinator users are forbidden and forbidden attempts are immutable (no notification calls / no D7 mutation)', async () => {
    await seedPendingGrades();
    axiosPostSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { ok: true } });

    const beforeGrades = await FinalGrade.find({ groupId: GROUP_ID }).lean();
    const beforeSnapshot = JSON.stringify(
      beforeGrades.map((g) => ({
        finalGradeId: g.finalGradeId,
        status: g.status,
        publishedAt: g.publishedAt || null,
        publishedBy: g.publishedBy || null
      }))
    );

    const disallowedUsers = [
      users.professorAssigned,
      users.professorUnassigned,
      users.advisorAssigned,
      users.advisorUnassigned,
      users.student
    ];

    for (const user of disallowedUsers) {
      const response = await request(app)
        .post(`/api/v1/groups/${GROUP_ID}/final-grades/publish`)
        .set('Authorization', `Bearer ${tokenFor(user)}`)
        .send({ publishCycle: PUBLISH_CYCLE });

      trackMatrix(`${user.role}:${user.userId}`, 'POST /groups/{groupId}/final-grades/publish', 403, response.status);
      expectStable403(response);
      expect(response.body.error).toBe(
        'Forbidden - only the Coordinator role may publish final grades'
      );
      expect(response.body.code).toBe('UNAUTHORIZED_ROLE');
    }

    expect(axiosPostSpy).not.toHaveBeenCalled();

    const afterGrades = await FinalGrade.find({ groupId: GROUP_ID }).lean();
    const afterSnapshot = JSON.stringify(
      afterGrades.map((g) => ({
        finalGradeId: g.finalGradeId,
        status: g.status,
        publishedAt: g.publishedAt || null,
        publishedBy: g.publishedBy || null
      }))
    );

    expect(afterSnapshot).toBe(beforeSnapshot);
  });

  it('8.5 Publish: system backend token is allowed and creates SYSTEM_ACCESS_AUDIT entry', async () => {
    await seedPendingGrades();

    const response = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/publish`)
      .set('x-system-auth', getSystemToken())
      .send({ publishCycle: PUBLISH_CYCLE });

    trackMatrix('system-backend', 'POST /groups/{groupId}/final-grades/publish', 200, response.status);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const AuditLog = require('../src/models/AuditLog');
    const auditEntry = await AuditLog.findOne({
      action: 'SYSTEM_ACCESS_AUDIT',
      groupId: GROUP_ID
    }).lean();
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.actorId).toBe('SYSTEM');
  });

  it('Backward compatibility: /approval legacy route still works and emits DEPRECATED_ROUTE_USED warning', async () => {
    await seedPendingGrades();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await request(app)
      .post(`/api/v1/groups/${GROUP_ID}/final-grades/approval`)
      .set('Authorization', `Bearer ${tokenFor(users.coordinator)}`)
      .send({
        publishCycle: PUBLISH_CYCLE,
        decision: 'approve',
        reason: 'legacy-route-compatibility'
      });

    trackMatrix('coordinator', 'POST /groups/{groupId}/final-grades/approval', 200, response.status);
    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      '[DEPRECATED_ROUTE_USED] POST /final-grades/approval is deprecated; prefer /final-grades/approve'
    );
  });
});
