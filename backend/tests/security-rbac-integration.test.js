const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = require('../src/index');
const { generateAccessToken } = require('../src/utils/jwt');
const Group = require('../src/models/Group');
const Deliverable = require('../src/models/Deliverable');
const Evaluation = require('../src/models/Evaluation');
const SprintConfig = require('../src/models/SprintConfig');
const ContributionRecord = require('../src/models/ContributionRecord');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../src/models/FinalGrade');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

describe('Process 8 Security Integration & RBAC Matrix Audit', () => {
  let mongoReplSet;
  let axiosPostSpy;

  const GROUP_ID = 'grp_1';
  const OTHER_GROUP_ID = 'grp_other';
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

  /**
   * Generates an expired token for security tests
   * ISSUE #261: Test expired token behavior (expects 401)
   */
  const expiredTokenFor = (user) => {
    return jwt.sign(
      { userId: user.userId, role: user.role, type: 'access' },
      JWT_SECRET,
      { expiresIn: '-1h', issuer: 'senior-app', subject: user.userId }
    );
  };

  const trackMatrix = (role, endpoint, expected, actual) => {
    matrixRows.push({
      role,
      endpoint,
      expected,
      actual,
      pass: expected === actual ? 'yes' : 'no'
    });
  };

  const expectStable403 = (response, expectedCode = 'UNAUTHORIZED_ROLE') => {
    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('code', expectedCode);
    expect(response.body).toHaveProperty('message');
  };

  const expectStable401 = (response, expectedCode = 'INVALID_TOKEN') => {
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('code', expectedCode);
  };

  const seedPreviewPrerequisites = async () => {
    // Group 1: Assigned to professorAssigned
    await Group.create({
      groupId: GROUP_ID,
      groupName: 'RBAC Security Group',
      leaderId: 'leader_1',
      advisorId: users.advisorAssigned.userId,
      professorId: users.professorAssigned.userId,
      status: 'active'
    });

    // Group Other: Assigned to someone else (Test for Cross-Owner Access)
    await Group.create({
      groupId: OTHER_GROUP_ID,
      groupName: 'Other Group',
      leaderId: 'leader_other',
      advisorId: 'other_advisor',
      professorId: 'other_professor',
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
    
    try {
      await mongoose.connection.createCollection('auditlogs');
    } catch (_error) {
      // Ignore
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

  describe('8.1-8.3 Preview RBAC Matrix', () => {
    it('should allow coordinator, assigned professor, and assigned advisor to preview', async () => {
      await seedPreviewPrerequisites();

      const authorizedRoles = [
        { user: users.coordinator, label: 'coordinator' },
        { user: users.professorAssigned, label: 'professor(assigned)' },
        { user: users.advisorAssigned, label: 'advisor(assigned)' }
      ];

      for (const { user, label } of authorizedRoles) {
        const response = await request(app)
          .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
          .set('Authorization', `Bearer ${tokenFor(user)}`)
          .send({ requestedBy: user.userId, useLatestRatios: false });
        
        trackMatrix(label, 'POST /groups/{groupId}/final-grades/preview', 200, response.status);
        expect(response.status).toBe(200);
      }
    });

    it('should forbid unassigned professor/advisor and students from previewing', async () => {
      await seedPreviewPrerequisites();

      const forbiddenRoles = [
        { user: users.professorUnassigned, label: 'professor(unassigned)' },
        { user: users.advisorUnassigned, label: 'advisor(unassigned)' },
        { user: users.student, label: 'student' }
      ];

      for (const { user, label } of forbiddenRoles) {
        const response = await request(app)
          .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
          .set('Authorization', `Bearer ${tokenFor(user)}`)
          .send({ requestedBy: user.userId, useLatestRatios: false });
        
        trackMatrix(label, 'POST /groups/{groupId}/final-grades/preview', 403, response.status);
        expectStable403(response, 'FORBIDDEN_PREVIEW_ACCESS');
      }
    });

    /**
     * ISSUE #261: Test for Cross-Owner Access
     */
    it('should forbid cross-owner access (Professor A accessing Group B)', async () => {
      await seedPreviewPrerequisites();

      // professorAssigned is assigned to GROUP_ID, but NOT to OTHER_GROUP_ID
      const response = await request(app)
        .post(`/api/v1/groups/${OTHER_GROUP_ID}/final-grades/preview`)
        .set('Authorization', `Bearer ${tokenFor(users.professorAssigned)}`)
        .send({ requestedBy: users.professorAssigned.userId, useLatestRatios: false });
      
      trackMatrix('professor(assigned to A)', 'POST /groups/B/final-grades/preview', 403, response.status);
      expectStable403(response, 'FORBIDDEN_PREVIEW_ACCESS');
      expect(response.body.message).toContain('authorized Professor/Advisor');
    });

    /**
     * ISSUE #261: Test for Expired Token
     */
    it('should return 401 for expired token', async () => {
      await seedPreviewPrerequisites();

      const response = await request(app)
        .post(`/api/v1/groups/${GROUP_ID}/final-grades/preview`)
        .set('Authorization', `Bearer ${expiredTokenFor(users.coordinator)}`)
        .send({ requestedBy: users.coordinator.userId });
      
      trackMatrix('coordinator(expired)', 'POST /groups/{groupId}/final-grades/preview', 401, response.status);
      expectStable401(response, 'INVALID_TOKEN');
      expect(response.body.message).toContain('expired');
    });
  });

  describe('8.4 Approval RBAC Matrix', () => {
    it('should only allow coordinator to approve final grades', async () => {
      await seedPendingGrades();

      const response = await request(app)
        .post(`/api/v1/groups/${GROUP_ID}/final-grades/approve`)
        .set('Authorization', `Bearer ${tokenFor(users.coordinator)}`)
        .send({
          publishCycle: PUBLISH_CYCLE,
          decision: 'approve'
        });
      
      trackMatrix('coordinator', 'POST /groups/{groupId}/final-grades/approve', 200, response.status);
      expect(response.status).toBe(200);
    });

    it('should forbid all other roles from approving grades', async () => {
      await seedPendingGrades();

      const disallowed = [
        users.professorAssigned,
        users.advisorAssigned,
        users.student
      ];

      for (const user of disallowed) {
        const response = await request(app)
          .post(`/api/v1/groups/${GROUP_ID}/final-grades/approve`)
          .set('Authorization', `Bearer ${tokenFor(user)}`)
          .send({
            publishCycle: PUBLISH_CYCLE,
            decision: 'approve'
          });

        trackMatrix(user.role, 'POST /groups/{groupId}/final-grades/approve', 403, response.status);
        expectStable403(response, 'UNAUTHORIZED_ROLE');
      }
    });
  });

  describe('8.5 Publish RBAC Matrix', () => {
    it('should forbid non-coordinator users and verify immutability', async () => {
      await seedPendingGrades();
      axiosPostSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { ok: true } });

      const beforeGrades = await FinalGrade.find({ groupId: GROUP_ID }).lean();

      const disallowed = [users.professorAssigned, users.student];

      for (const user of disallowed) {
        const response = await request(app)
          .post(`/api/v1/groups/${GROUP_ID}/final-grades/publish`)
          .set('Authorization', `Bearer ${tokenFor(user)}`)
          .send({ publishCycle: PUBLISH_CYCLE });

        trackMatrix(user.role, 'POST /groups/{groupId}/final-grades/publish', 403, response.status);
        expectStable403(response, 'UNAUTHORIZED_ROLE');
      }

      // Verify no notification was sent and no DB mutation
      expect(axiosPostSpy).not.toHaveBeenCalled();
      const afterGrades = await FinalGrade.find({ groupId: GROUP_ID }).lean();
      expect(JSON.stringify(afterGrades)).toBe(JSON.stringify(beforeGrades));
    });

    it('should allow system backend token with SYSTEM_ACCESS_AUDIT log', async () => {
      await seedPendingGrades();

      const response = await request(app)
        .post(`/api/v1/groups/${GROUP_ID}/final-grades/publish`)
        .set('x-system-auth', getSystemToken())
        .send({ publishCycle: PUBLISH_CYCLE });

      trackMatrix('system-backend', 'POST /groups/{groupId}/final-grades/publish', 200, response.status);
      expect(response.status).toBe(200);

      const AuditLog = require('../src/models/AuditLog');
      const auditEntry = await AuditLog.findOne({
        action: 'SYSTEM_ACCESS_AUDIT',
        groupId: GROUP_ID
      }).lean();
      expect(auditEntry).toBeTruthy();
      expect(auditEntry.actorId).toBe('SYSTEM');
    });
  });
});
