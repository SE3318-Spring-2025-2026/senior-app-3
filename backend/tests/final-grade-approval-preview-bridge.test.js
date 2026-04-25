'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/index');
const Deliverable = require('../src/models/Deliverable');
const Evaluation = require('../src/models/Evaluation');
const ContributionRecord = require('../src/models/ContributionRecord');
const Group = require('../src/models/Group');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../src/models/FinalGrade');
const { generateAccessToken } = require('../src/utils/jwt');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({})
    )
  );
});

describe('Final grade preview approval bridge', () => {
  const groupId = 'grp-approval-bridge';
  const coordinatorToken = generateAccessToken('coord-1', 'coordinator');
  const studentToken = generateAccessToken('student-1', 'student');

  const seedPreviewInputs = async () => {
    await Group.create({
      groupId,
      groupName: 'Approval Bridge Group',
      leaderId: 'student-1',
      members: [
        {
          userId: 'student-1',
          role: 'leader',
          status: 'accepted',
          joinedAt: new Date()
        }
      ],
      status: 'active'
    });

    await Deliverable.create({
      deliverableId: 'del-final',
      groupId,
      submittedBy: 'student-1',
      deliverableType: 'final_report',
      filePath: '/tmp/final.pdf',
      fileSize: 100,
      fileHash: 'hash-final',
      format: 'pdf',
      status: 'accepted',
      submittedAt: new Date()
    });

    await Evaluation.create({
      evaluationId: 'eval-final',
      deliverableId: 'del-final',
      groupId,
      evaluatorId: 'prof-1',
      score: 80,
      status: 'completed'
    });

    await ContributionRecord.create({
      contributionRecordId: 'ctr-student-1',
      sprintId: 'sprint-1',
      studentId: 'student-1',
      groupId,
      contributionRatio: 1
    });
  };

  it('keeps standard preview read-only by default', async () => {
    await seedPreviewInputs();

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ useLatestRatios: false });

    expect(response.status).toBe(200);
    expect(response.body.groupId).toBe(groupId);
    expect(response.body.publishCycle).toBeUndefined();

    const finalGrades = await FinalGrade.find({ groupId });
    expect(finalGrades).toHaveLength(0);
  });

  it('persists pending approval rows when requested by a coordinator', async () => {
    await seedPreviewInputs();

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        persistForApproval: true,
        publishCycle: 'cycle-2026',
        useLatestRatios: false
      });

    expect(response.status).toBe(200);
    expect(response.body.publishCycle).toBe('cycle-2026');
    expect(response.body.persistedForApproval).toBe(true);

    const finalGrades = await FinalGrade.find({ groupId, publishCycle: 'cycle-2026' });
    expect(finalGrades).toHaveLength(1);
    expect(finalGrades[0].status).toBe(FINAL_GRADE_STATUS.PENDING);
    expect(finalGrades[0].computedFinalGrade).toBe(80);
  });

  it('allows approval with overrides after a persisted preview', async () => {
    await seedPreviewInputs();

    await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        persistForApproval: true,
        publishCycle: 'cycle-override',
        useLatestRatios: false
      });

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/approval`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        publishCycle: 'cycle-override',
        decision: 'approve',
        overrideEntries: [
          {
            studentId: 'student-1',
            originalFinalGrade: 80,
            overriddenFinalGrade: 85,
            comment: 'Coordinator adjustment'
          }
        ],
        reason: 'Approved with adjustment'
      });

    expect(response.status).toBe(200);
    expect(response.body.publishCycle).toBe('cycle-override');
    expect(response.body.overridesApplied).toBe(1);

    const savedGrade = await FinalGrade.findOne({ groupId, publishCycle: 'cycle-override' });
    expect(savedGrade.status).toBe(FINAL_GRADE_STATUS.APPROVED);
    expect(savedGrade.overriddenFinalGrade).toBe(85);
  });

  it('rejects approval persistence for non-coordinators', async () => {
    await seedPreviewInputs();

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        persistForApproval: true,
        publishCycle: 'cycle-forbidden',
        useLatestRatios: false
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_PREVIEW_ACCESS');

    const finalGrades = await FinalGrade.find({ groupId });
    expect(finalGrades).toHaveLength(0);
  });

  it('reject decision creates a terminal rejected state that blocks publishing', async () => {
    await seedPreviewInputs();

    await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        persistForApproval: true,
        publishCycle: 'cycle-reject',
        useLatestRatios: false
      });

    const rejectResponse = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/approval`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        publishCycle: 'cycle-reject',
        decision: 'reject',
        reason: 'Needs recalculation'
      });

    expect(rejectResponse.status).toBe(200);

    const publishResponse = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/publish`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ notifyStudents: false, notifyFaculty: false });

    expect(publishResponse.status).toBe(422);
  });
});
