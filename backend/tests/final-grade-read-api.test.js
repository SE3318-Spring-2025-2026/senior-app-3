const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../src/index');
const Group = require('../src/models/Group');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../src/models/FinalGrade');
const { generateAccessToken } = require('../src/utils/jwt');

describe('Issue #258 / Script #255 published final grade read APIs', () => {
  let mongoServer;

  const groupId = 'grp_read_api';
  const otherGroupId = 'grp_other_read_api';
  const publishCycle = '2026-Spring';
  const coordinator = { userId: 'coord_read_api', role: 'coordinator' };
  const professor = { userId: 'prof_read_api', role: 'professor' };
  const advisor = { userId: 'adv_read_api', role: 'advisor' };
  const studentOne = { userId: 'stu_read_one', role: 'student' };
  const studentTwo = { userId: 'stu_read_two', role: 'student' };

  const tokenFor = (user) => generateAccessToken(user.userId, user.role);

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  const seedGroupAndGrades = async () => {
    await Group.create({
      groupId,
      groupName: 'Read API Group',
      leaderId: studentOne.userId,
      professorId: professor.userId,
      advisorId: advisor.userId,
      status: 'active',
      members: [
        { userId: studentOne.userId, role: 'leader', status: 'accepted' },
        { userId: studentTwo.userId, role: 'member', status: 'accepted' }
      ]
    });

    await Group.create({
      groupId: otherGroupId,
      groupName: 'Other Read API Group',
      leaderId: 'other_student',
      status: 'active',
      members: [{ userId: 'other_student', role: 'leader', status: 'accepted' }]
    });

    await FinalGrade.create([
      {
        finalGradeId: 'fg_read_one_published',
        groupId,
        studentId: studentOne.userId,
        publishCycle,
        baseGroupScore: 90,
        individualRatio: 1,
        computedFinalGrade: 90,
        status: FINAL_GRADE_STATUS.PUBLISHED,
        publishedAt: new Date('2026-04-01T12:00:00Z'),
        publishedBy: coordinator.userId
      },
      {
        finalGradeId: 'fg_read_two_published',
        groupId,
        studentId: studentTwo.userId,
        publishCycle,
        baseGroupScore: 90,
        individualRatio: 0.9,
        computedFinalGrade: 81,
        overrideApplied: true,
        originalFinalGrade: 81,
        overriddenFinalGrade: 85,
        status: FINAL_GRADE_STATUS.PUBLISHED,
        publishedAt: new Date('2026-04-01T12:00:00Z'),
        publishedBy: coordinator.userId
      },
      {
        finalGradeId: 'fg_read_one_pending',
        groupId,
        studentId: studentOne.userId,
        publishCycle: '2026-Draft',
        baseGroupScore: 100,
        individualRatio: 1,
        computedFinalGrade: 100,
        status: FINAL_GRADE_STATUS.PENDING
      },
      {
        finalGradeId: 'fg_read_other_published',
        groupId: otherGroupId,
        studentId: 'other_student',
        publishCycle,
        baseGroupScore: 70,
        individualRatio: 1,
        computedFinalGrade: 70,
        status: FINAL_GRADE_STATUS.PUBLISHED,
        publishedAt: new Date('2026-04-01T12:00:00Z'),
        publishedBy: coordinator.userId
      }
    ]);
  };

  it('allows coordinators to read all published group rows', async () => {
    await seedGroupAndGrades();

    const response = await request(app)
      .get(`/api/v1/groups/${groupId}/final-grades?status=published`)
      .set('Authorization', `Bearer ${tokenFor(coordinator)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      groupId,
      status: 'published'
    });
    expect(response.body.grades).toHaveLength(2);
    expect(response.body.grades.map((grade) => grade.studentId).sort()).toEqual([
      studentOne.userId,
      studentTwo.userId
    ]);
    expect(response.body.grades.every((grade) => grade.status === 'published')).toBe(true);
    expect(response.body.grades.find((grade) => grade.studentId === studentTwo.userId).finalGrade).toBe(85);
  });

  it('forbids students from reading the group endpoint and enforces /me/final-grades', async () => {
    await seedGroupAndGrades();

    const response = await request(app)
      .get(`/api/v1/groups/${groupId}/final-grades?status=published`)
      .set('Authorization', `Bearer ${tokenFor(studentOne)}`);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'FORBIDDEN_PUBLISHED_GRADE_READ'
    });
    expect(response.body.message).toContain('/api/v1/me/final-grades');
  });

  it('allows assigned professor/advisor to read published rows in their group', async () => {
    await seedGroupAndGrades();

    const professorResponse = await request(app)
      .get(`/api/v1/groups/${groupId}/final-grades?status=published`)
      .set('Authorization', `Bearer ${tokenFor(professor)}`);

    const advisorResponse = await request(app)
      .get(`/api/v1/groups/${groupId}/final-grades?status=published`)
      .set('Authorization', `Bearer ${tokenFor(advisor)}`);

    expect(professorResponse.status).toBe(200);
    expect(advisorResponse.status).toBe(200);
    expect(professorResponse.body.grades).toHaveLength(2);
    expect(advisorResponse.body.grades).toHaveLength(2);
  });

  it('allows students to read only their own published rows from /me/final-grades', async () => {
    await seedGroupAndGrades();

    const response = await request(app)
      .get('/api/v1/me/final-grades')
      .set('Authorization', `Bearer ${tokenFor(studentOne)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      studentId: studentOne.userId,
      status: 'published'
    });
    expect(response.body.grades).toHaveLength(1);
    expect(response.body.grades[0].studentId).toBe(studentOne.userId);
    expect(response.body.grades[0].status).toBe('published');
  });

  it('does not leak unpublished grades through read APIs', async () => {
    await seedGroupAndGrades();

    const groupResponse = await request(app)
      .get(`/api/v1/groups/${groupId}/final-grades`)
      .set('Authorization', `Bearer ${tokenFor(coordinator)}`);

    const selfResponse = await request(app)
      .get('/api/v1/me/final-grades')
      .set('Authorization', `Bearer ${tokenFor(studentOne)}`);

    expect(groupResponse.status).toBe(200);
    expect(selfResponse.status).toBe(200);
    expect(groupResponse.body.grades.some((grade) => grade.finalGradeId === 'fg_read_one_pending')).toBe(false);
    expect(selfResponse.body.grades.some((grade) => grade.finalGradeId === 'fg_read_one_pending')).toBe(false);
  });

  it('forbids students from reading a group where they are not an accepted member', async () => {
    await seedGroupAndGrades();

    const response = await request(app)
      .get(`/api/v1/groups/${otherGroupId}/final-grades?status=published`)
      .set('Authorization', `Bearer ${tokenFor(studentOne)}`);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'FORBIDDEN_PUBLISHED_GRADE_READ'
    });
    expect(response.body.message).toContain('/api/v1/me/final-grades');
  });

  it('forbids non-coordinator broad group reads', async () => {
    await seedGroupAndGrades();

    const response = await request(app)
      .get(`/api/v1/groups/${otherGroupId}/final-grades?status=published`)
      .set('Authorization', `Bearer ${tokenFor(professor)}`);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'FORBIDDEN_PUBLISHED_GRADE_READ'
    });
    expect(response.body.message).toContain('only Coordinators');
  });

  it('returns 400 for invalid status query parameter', async () => {
    await seedGroupAndGrades();

    const response = await request(app)
      .get(`/api/v1/groups/${groupId}/final-grades?status=INVALID`)
      .set('Authorization', `Bearer ${tokenFor(coordinator)}`);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'INVALID_STATUS_FILTER'
    });
  });
});
