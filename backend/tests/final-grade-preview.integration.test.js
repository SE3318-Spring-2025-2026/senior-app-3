process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/index');

const Group = require('../src/models/Group');
const GroupMembership = require('../src/models/GroupMembership');
const ContributionRecord = require('../src/models/ContributionRecord');
const User = require('../src/models/User');
const { generateAccessToken } = require('../src/utils/jwt');

describe('Final grade preview endpoint orchestration', () => {
  jest.setTimeout(30000);

  let mongod;
  let coordinatorToken;
  let assignedProfessorToken;
  let unassignedProfessorToken;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    const coordinator = await User.create({
      userId: 'usr_preview_coord',
      email: 'preview.coordinator@example.com',
      hashedPassword: 'hashed-password-for-tests',
      role: 'coordinator',
      emailVerified: true,
      accountStatus: 'active',
    });
    const assignedProfessor = await User.create({
      userId: 'usr_preview_prof_assigned',
      email: 'preview.prof.assigned@example.com',
      hashedPassword: 'hashed-password-for-tests',
      role: 'professor',
      emailVerified: true,
      accountStatus: 'active',
    });
    const unassignedProfessor = await User.create({
      userId: 'usr_preview_prof_unassigned',
      email: 'preview.prof.unassigned@example.com',
      hashedPassword: 'hashed-password-for-tests',
      role: 'professor',
      emailVerified: true,
      accountStatus: 'active',
    });

    coordinatorToken = generateAccessToken(coordinator.userId, 'coordinator');
    assignedProfessorToken = generateAccessToken(assignedProfessor.userId, 'professor');
    unassignedProfessorToken = generateAccessToken(unassignedProfessor.userId, 'professor');
  });

  afterEach(async () => {
    await Promise.all([
      Group.deleteMany({ groupId: /^grp_preview_/ }),
      GroupMembership.deleteMany({ groupId: /^grp_preview_/ }),
      ContributionRecord.deleteMany({ groupId: /^grp_preview_/ }),
      User.deleteMany({ userId: /^usr_preview_student_/ }),
    ]);
  });

  afterAll(async () => {
    await User.deleteMany({
      userId: {
        $in: ['usr_preview_coord', 'usr_preview_prof_assigned', 'usr_preview_prof_unassigned'],
      },
    });
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  test('orchestrates preview flow and embeds warnings per student', async () => {
    const groupId = 'grp_preview_success';

    await Group.create({
      groupId,
      groupName: 'Preview Success Group',
      leaderId: 'usr_preview_student_alice',
      status: 'active',
    });

    await User.create({
      userId: 'usr_preview_student_alice',
      email: 'preview.alice@example.com',
      hashedPassword: 'hashed-password-for-tests',
      role: 'student',
      githubUsername: null,
      emailVerified: true,
      accountStatus: 'active',
    });

    await GroupMembership.create({
      groupId,
      studentId: 'usr_preview_student_alice',
      status: 'approved',
    });

    await ContributionRecord.create({
      groupId,
      sprintId: 'sprint_preview_1',
      studentId: 'usr_preview_student_alice',
      contributionRatio: 0.8,
      storyPointsAssigned: 10,
      storyPointsCompleted: 8,
      pullRequestsMerged: 1,
      issuesResolved: 1,
      commitsCount: 1,
      recalculatedAt: new Date('2026-04-01T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: 'usr_preview_coord',
        useLatestRatios: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.groupId).toBe(groupId);
    expect(response.body.baseGroupScore).toBe(100);
    expect(Array.isArray(response.body.students)).toBe(true);
    expect(response.body.students).toHaveLength(1);
    expect(response.body.students[0]).toMatchObject({
      studentId: 'usr_preview_student_alice',
      contributionRatio: 0.8,
      computedFinalGrade: 80,
    });
    expect(response.body.students[0].warnings).toEqual([
      expect.objectContaining({
        code: 'MISSING_GITHUB_MAPPING',
        severity: 'warning',
      }),
    ]);
  });

  test('ignores spoofed requestedBy and derives identity from authenticated token', async () => {
    const groupId = 'grp_preview_spoofing_guard';

    await Group.create({
      groupId,
      groupName: 'Preview Spoofing Guard Group',
      leaderId: 'usr_preview_student_alice',
      professorId: 'usr_preview_prof_assigned',
      advisorId: 'usr_preview_prof_assigned',
      status: 'active',
    });

    await User.create({
      userId: 'usr_preview_student_alice',
      email: 'preview.alice3@example.com',
      hashedPassword: 'hashed-password-for-tests',
      role: 'student',
      githubUsername: null,
      emailVerified: true,
      accountStatus: 'active',
    });

    await GroupMembership.create({
      groupId,
      studentId: 'usr_preview_student_alice',
      status: 'approved',
    });

    await ContributionRecord.create({
      groupId,
      sprintId: 'sprint_preview_1',
      studentId: 'usr_preview_student_alice',
      contributionRatio: 0.9,
      storyPointsAssigned: 10,
      storyPointsCompleted: 9,
      pullRequestsMerged: 1,
      issuesResolved: 1,
      commitsCount: 1,
      recalculatedAt: new Date('2026-04-01T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${assignedProfessorToken}`)
      .send({
        requestedBy: 'usr_actor_spoof_attempt',
        useLatestRatios: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.groupId).toBe(groupId);
    expect(response.body.students).toHaveLength(1);
  });

  test('returns 422 when any enrolled student is missing ratios', async () => {
    const groupId = 'grp_preview_missing_ratio';

    await Group.create({
      groupId,
      groupName: 'Preview Missing Ratio Group',
      leaderId: 'usr_preview_student_alice',
      status: 'active',
    });

    await User.insertMany([
      {
        userId: 'usr_preview_student_alice',
        email: 'preview.alice2@example.com',
        hashedPassword: 'hashed-password-for-tests',
        role: 'student',
        githubUsername: 'alice-gh',
        emailVerified: true,
        accountStatus: 'active',
      },
      {
        userId: 'usr_preview_student_bob',
        email: 'preview.bob@example.com',
        hashedPassword: 'hashed-password-for-tests',
        role: 'student',
        githubUsername: 'bob-gh',
        emailVerified: true,
        accountStatus: 'active',
      },
    ]);

    await GroupMembership.insertMany([
      {
        groupId,
        studentId: 'usr_preview_student_alice',
        status: 'approved',
      },
      {
        groupId,
        studentId: 'usr_preview_student_bob',
        status: 'approved',
      },
    ]);

    await ContributionRecord.create({
      groupId,
      sprintId: 'sprint_preview_1',
      studentId: 'usr_preview_student_alice',
      contributionRatio: 0.7,
      storyPointsAssigned: 10,
      storyPointsCompleted: 7,
      pullRequestsMerged: 1,
      issuesResolved: 1,
      commitsCount: 1,
      recalculatedAt: new Date('2026-04-01T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        requestedBy: 'usr_preview_coord',
        useLatestRatios: true,
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('MISSING_CONTRIBUTION_RATIOS');
    expect(response.body.details.missingStudentIds).toEqual(['usr_preview_student_bob']);
  });

  test('returns 403 when professor is not assigned to target group', async () => {
    const groupId = 'grp_preview_forbidden_professor';

    await Group.create({
      groupId,
      groupName: 'Preview Forbidden Professor Group',
      leaderId: 'usr_preview_student_alice',
      professorId: 'usr_preview_prof_assigned',
      advisorId: 'usr_preview_prof_assigned',
      status: 'active',
    });

    await User.create({
      userId: 'usr_preview_student_alice',
      email: 'preview.alice4@example.com',
      hashedPassword: 'hashed-password-for-tests',
      role: 'student',
      githubUsername: 'alice-gh',
      emailVerified: true,
      accountStatus: 'active',
    });

    await GroupMembership.create({
      groupId,
      studentId: 'usr_preview_student_alice',
      status: 'approved',
    });

    await ContributionRecord.create({
      groupId,
      sprintId: 'sprint_preview_1',
      studentId: 'usr_preview_student_alice',
      contributionRatio: 0.85,
      storyPointsAssigned: 10,
      storyPointsCompleted: 8.5,
      pullRequestsMerged: 1,
      issuesResolved: 1,
      commitsCount: 1,
      recalculatedAt: new Date('2026-04-01T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await request(app)
      .post(`/api/v1/groups/${groupId}/final-grades/preview`)
      .set('Authorization', `Bearer ${unassignedProfessorToken}`)
      .send({
        requestedBy: 'usr_preview_prof_unassigned',
        useLatestRatios: true,
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      'Access denied: You are not assigned as an advisor or professor for this group.'
    );
    expect(response.body.code).toBe('FORBIDDEN_GROUP_ACCESS');
  });
});
