const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/index');

const Group = require('../src/models/Group');
const Deliverable = require('../src/models/Deliverable');
const SprintRecord = require('../src/models/SprintRecord');
const ContributionRecord = require('../src/models/ContributionRecord');
const { FinalGrade } = require('../src/models/FinalGrade');
const { generateAccessToken } = require('../src/utils/jwt');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany();
  }
});

describe('POST /api/v1/groups/:groupId/final-grades/preview', () => {
  let coordinatorToken;
  let advisorToken;
  let studentToken;

  const coordinatorId = 'coord123';
  const advisorId = 'adv123';
  const studentId = 'stu123';
  const groupId = 'grp123';

  beforeEach(() => {
    coordinatorToken = generateAccessToken(coordinatorId, 'coordinator');
    advisorToken = generateAccessToken(advisorId, 'advisor');
    studentToken = generateAccessToken(studentId, 'student');
  });

  const createPrerequisites = async (groupStatus = 'active', ratioSum = 1.0) => {
    await Group.create({
      groupId,
      groupName: 'Test Group',
      leaderId: studentId,
      advisorId,
      status: groupStatus
    });

    await Deliverable.create({
      deliverableId: 'del1',
      groupId,
      submittedBy: studentId,
      deliverableType: 'final_report',
      filePath: '/path',
      fileSize: 100,
      fileHash: 'hash',
      format: 'pdf',
      status: 'accepted'
    });

    await SprintRecord.create({
      sprintRecordId: 'sr1',
      sprintId: 'sp1',
      groupId
    });

    await ContributionRecord.create({
      contributionRecordId: 'cr1',
      sprintId: 'sp1',
      studentId: studentId,
      groupId,
      contributionRatio: ratioSum
    });
  };

  it('should return 200 and a valid FinalGradesPreview when successfully generated', async () => {
    await createPrerequisites();

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: coordinatorId,
        useLatestRatios: false
      });

    expect(response.status).toBe(200);
    expect(response.body.groupId).toBe(groupId);
    expect(response.body.baseGroupScore).toBeDefined();
    expect(response.body.students.length).toBe(1);
    expect(response.body.students[0].studentId).toBe(studentId);
    expect(response.body.students[0].contributionRatio).toBe(1.0);
    expect(response.body.createdAt).toBeDefined();

    // Verify ZERO persistence
    const finalGrades = await FinalGrade.find({ groupId });
    expect(finalGrades.length).toBe(0);
  });

  it('should return 403 Forbidden with exact OpenAPI wording for unauthorized roles', async () => {
    await createPrerequisites();

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        requestedBy: studentId
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades');
  });

  it('should return 403 Forbidden if advisor requests preview for a group they do not own', async () => {
    await createPrerequisites();
    const otherAdvisorToken = generateAccessToken('otherAdv', 'advisor');

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${otherAdvisorToken}`)
      .send({
        requestedBy: 'otherAdv'
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades');
  });

  it('should return 404 when prerequisite data is missing', async () => {
    await Group.create({
      groupId,
      groupName: 'Test Group',
      leaderId: studentId,
      advisorId,
      status: 'active'
    });
    // Missing Deliverables and Sprints

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: coordinatorId
      });

    expect(response.status).toBe(404);
  });

  it('should return 409 when group is locked/archived', async () => {
    await createPrerequisites('archived');

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: coordinatorId
      });

    expect(response.status).toBe(409);
  });

  it('should return 409 when ratios are inconsistent', async () => {
    // Ratios sum to 0.5 instead of 1.0
    await createPrerequisites('active', 0.5);

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: coordinatorId,
        useLatestRatios: false
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Conflict - preview cannot be generated due to inconsistent or locked configuration');
  });

  it('should fail fast when useLatestRatios is true and latest ratio recalculation cannot complete', async () => {
    await createPrerequisites();

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: coordinatorId,
        useLatestRatios: true
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Latest ratio recalculation failed for sprint');
  });

  it('should return 409 when ratios sum to 0.98 (strict epsilon validation)', async () => {
    await createPrerequisites('active', 0.98);

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: coordinatorId,
        useLatestRatios: false
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Conflict - preview cannot be generated due to inconsistent or locked configuration');
  });
});
