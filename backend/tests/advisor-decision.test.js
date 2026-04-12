const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/index');
const { generateTokenPair } = require('../src/utils/jwt');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const AdvisorRequest = require('../src/models/AdvisorRequest');
const ScheduleWindow = require('../src/models/ScheduleWindow');

const MONGO_URI =
  process.env.MONGODB_TEST_URI ||
  'mongodb://localhost:27017/senior-app-test-advisor-decision';

const authHeader = (userId, role) => {
  const { accessToken } = generateTokenPair(userId, role);
  return `Bearer ${accessToken}`;
};

const createUser = (overrides = {}) =>
  User.create({
    email: `${Date.now()}_${Math.random()}@example.com`,
    hashedPassword: 'hashed',
    role: 'professor',
    accountStatus: 'active',
    ...overrides,
  });

const createAdvisorWindow = async () => {
  const now = new Date();
  return ScheduleWindow.create({
    operationType: 'advisor_decision',
    startsAt: new Date(now.getTime() - 10 * 60 * 1000),
    endsAt: new Date(now.getTime() + 60 * 60 * 1000),
    isActive: true,
    createdBy: 'usr_coord_1',
  });
};

describe('PATCH /api/v1/advisor-requests/:requestId', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Group.deleteMany({}),
      AdvisorRequest.deleteMany({}),
      ScheduleWindow.deleteMany({}),
    ]);
  });

  it('approves request and returns assignedGroupId', async () => {
    await createAdvisorWindow();
    const professor = await createUser({ userId: 'usr_prof_1', role: 'professor' });
    await createUser({ userId: 'usr_student_1', role: 'student' });
    const group = await Group.create({
      groupName: 'Advisor Group 1',
      groupId: 'grp_ad_1',
      leaderId: 'usr_student_1',
      status: 'active',
    });
    const requestDoc = await AdvisorRequest.create({
      requestId: 'arq_test_1',
      groupId: group.groupId,
      professorId: professor.userId,
      requesterId: 'usr_student_1',
      status: 'pending',
      message: 'Please advise our team.',
    });

    const res = await request(app)
      .patch(`/api/v1/advisor-requests/${requestDoc.requestId}`)
      .set('Authorization', authHeader(professor.userId, 'professor'))
      .send({ decision: 'approve', reason: 'Looks good' });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(requestDoc.requestId);
    expect(res.body.decision).toBe('approve');
    expect(res.body.approvalStatus).toBe('approved');
    expect(res.body.assignedGroupId).toBe(group.groupId);

    const updatedGroup = await Group.findOne({ groupId: group.groupId });
    expect(updatedGroup.advisorId).toBe(professor.userId);
  });

  it('rejects request and does not assign advisor', async () => {
    await createAdvisorWindow();
    const professor = await createUser({ userId: 'usr_prof_2', role: 'professor' });
    await createUser({ userId: 'usr_student_2', role: 'student' });
    const group = await Group.create({
      groupName: 'Advisor Group 2',
      groupId: 'grp_ad_2',
      leaderId: 'usr_student_2',
      status: 'active',
    });
    const requestDoc = await AdvisorRequest.create({
      requestId: 'arq_test_2',
      groupId: group.groupId,
      professorId: professor.userId,
      requesterId: 'usr_student_2',
      status: 'pending',
    });

    const res = await request(app)
      .patch(`/api/v1/advisor-requests/${requestDoc.requestId}`)
      .set('Authorization', authHeader(professor.userId, 'professor'))
      .send({ decision: 'reject', reason: 'Capacity full' });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('reject');
    expect(res.body.approvalStatus).toBe('rejected');
    expect(res.body.assignedGroupId).toBeNull();

    const updatedGroup = await Group.findOne({ groupId: group.groupId });
    expect(updatedGroup.advisorId).toBeNull();
  });

  it('returns 403 when a different professor tries to decide', async () => {
    await createAdvisorWindow();
    const ownerProfessor = await createUser({ userId: 'usr_prof_3', role: 'professor' });
    const otherProfessor = await createUser({ userId: 'usr_prof_4', role: 'professor' });
    await createUser({ userId: 'usr_student_3', role: 'student' });
    await Group.create({
      groupName: 'Advisor Group 3',
      groupId: 'grp_ad_3',
      leaderId: 'usr_student_3',
      status: 'active',
    });
    const requestDoc = await AdvisorRequest.create({
      requestId: 'arq_test_3',
      groupId: 'grp_ad_3',
      professorId: ownerProfessor.userId,
      requesterId: 'usr_student_3',
      status: 'pending',
    });

    const res = await request(app)
      .patch(`/api/v1/advisor-requests/${requestDoc.requestId}`)
      .set('Authorization', authHeader(otherProfessor.userId, 'professor'))
      .send({ decision: 'approve' });

    expect(res.status).toBe(403);
  });

  it('returns 409 when request already processed', async () => {
    await createAdvisorWindow();
    const professor = await createUser({ userId: 'usr_prof_5', role: 'professor' });
    await createUser({ userId: 'usr_student_4', role: 'student' });
    await Group.create({
      groupName: 'Advisor Group 4',
      groupId: 'grp_ad_4',
      leaderId: 'usr_student_4',
      status: 'active',
    });
    const requestDoc = await AdvisorRequest.create({
      requestId: 'arq_test_4',
      groupId: 'grp_ad_4',
      professorId: professor.userId,
      requesterId: 'usr_student_4',
      status: 'approved',
      processedAt: new Date(),
    });

    const res = await request(app)
      .patch(`/api/v1/advisor-requests/${requestDoc.requestId}`)
      .set('Authorization', authHeader(professor.userId, 'professor'))
      .send({ decision: 'reject' });

    expect(res.status).toBe(409);
  });

  it('returns 409 when group already has a different advisor', async () => {
    await createAdvisorWindow();
    const professor = await createUser({ userId: 'usr_prof_7', role: 'professor' });
    await createUser({ userId: 'usr_student_6', role: 'student' });
    await Group.create({
      groupName: 'Advisor Group 6',
      groupId: 'grp_ad_6',
      leaderId: 'usr_student_6',
      status: 'active',
      advisorId: 'usr_prof_existing',
    });
    const requestDoc = await AdvisorRequest.create({
      requestId: 'arq_test_6',
      groupId: 'grp_ad_6',
      professorId: professor.userId,
      requesterId: 'usr_student_6',
      status: 'pending',
    });

    const res = await request(app)
      .patch(`/api/v1/advisor-requests/${requestDoc.requestId}`)
      .set('Authorization', authHeader(professor.userId, 'professor'))
      .send({ decision: 'approve', reason: 'Approving this team' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GROUP_ALREADY_HAS_ADVISOR');

    const updatedGroup = await Group.findOne({ groupId: 'grp_ad_6' });
    expect(updatedGroup.advisorId).toBe('usr_prof_existing');
  });

  it('returns 422 when advisor association schedule is closed', async () => {
    const professor = await createUser({ userId: 'usr_prof_6', role: 'professor' });
    await createUser({ userId: 'usr_student_5', role: 'student' });
    await Group.create({
      groupName: 'Advisor Group 5',
      groupId: 'grp_ad_5',
      leaderId: 'usr_student_5',
      status: 'active',
    });
    const requestDoc = await AdvisorRequest.create({
      requestId: 'arq_test_5',
      groupId: 'grp_ad_5',
      professorId: professor.userId,
      requesterId: 'usr_student_5',
      status: 'pending',
    });

    const res = await request(app)
      .patch(`/api/v1/advisor-requests/${requestDoc.requestId}`)
      .set('Authorization', authHeader(professor.userId, 'professor'))
      .send({ decision: 'approve' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OUTSIDE_SCHEDULE_WINDOW');
    expect(res.body.reason).toBeUndefined();
    expect(res.body.message).toBeDefined();
  });
});
