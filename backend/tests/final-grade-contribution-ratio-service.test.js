process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  FinalGradeRatioResolverError,
  resolveContributionRatiosForPreview,
} = require('../src/services/finalGradeContributionRatioService');
const ContributionRecord = require('../src/models/ContributionRecord');
const Group = require('../src/models/Group');
const GroupMembership = require('../src/models/GroupMembership');
const User = require('../src/models/User');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});

beforeEach(async () => {
  await Promise.all(
    Object.keys(mongoose.connection.collections).map((key) =>
      mongoose.connection.collections[key].deleteMany({})
    )
  );
});

async function createUser(userId, overrides = {}) {
  return User.create({
    userId,
    email: `${userId}@example.com`,
    hashedPassword: 'hashed-password-for-tests',
    role: 'student',
    githubUsername: `${userId}-gh`,
    ...overrides,
  });
}

async function createGroup(groupId, overrides = {}) {
  return Group.create({
    groupId,
    groupName: `${groupId} Team`,
    leaderId: overrides.leaderId || 'usr_leader',
    status: 'active',
    ...overrides,
  });
}

async function addApprovedMembership(groupId, studentId) {
  return GroupMembership.create({
    groupId,
    studentId,
    status: 'approved',
  });
}

async function addContribution({
  groupId,
  sprintId,
  studentId,
  contributionRatio,
  recalculatedAt,
  lastUpdatedAt,
}) {
  return ContributionRecord.create({
    groupId,
    sprintId,
    studentId,
    contributionRatio,
    storyPointsAssigned: 10,
    storyPointsCompleted: 5,
    pullRequestsMerged: 1,
    issuesResolved: 1,
    commitsCount: 1,
    recalculatedAt,
    lastUpdatedAt,
  });
}

describe('Final grade contribution ratio resolver - Process 8.2', () => {
  test('selects the latest D6 ratio per enrolled student by recency fields', async () => {
    const groupId = 'grp_ratio_latest';
    await createGroup(groupId);
    await createUser('usr_alice');
    await createUser('usr_bob');
    await addApprovedMembership(groupId, 'usr_alice');
    await addApprovedMembership(groupId, 'usr_bob');

    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 0.25,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_2',
      studentId: 'usr_alice',
      contributionRatio: 0.75,
      recalculatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_bob',
      contributionRatio: 0.6,
      lastUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const result = await resolveContributionRatiosForPreview(groupId, {
      useLatestRatios: true,
    });

    expect(result.metadata.mode).toBe('latest');
    expect(result.students).toHaveLength(2);

    const alice = result.students.find((student) => student.studentId === 'usr_alice');
    const bob = result.students.find((student) => student.studentId === 'usr_bob');

    expect(alice.contributionRatio).toBe(0.75);
    expect(alice.selectedSprintIds).toEqual(['sprint_2']);
    expect(bob.contributionRatio).toBe(0.6);
    expect(result.warnings).toEqual([]);
  });

  test('averages explicit sprint ratios per student when useLatestRatios is false', async () => {
    const groupId = 'grp_ratio_explicit';
    await createGroup(groupId);
    await createUser('usr_alice');
    await createUser('usr_bob');
    await addApprovedMembership(groupId, 'usr_alice');
    await addApprovedMembership(groupId, 'usr_bob');

    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 0.5,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_2',
      studentId: 'usr_alice',
      contributionRatio: 0.7,
      recalculatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_bob',
      contributionRatio: 0.2,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_2',
      studentId: 'usr_bob',
      contributionRatio: 0.4,
      recalculatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_ignored',
      studentId: 'usr_bob',
      contributionRatio: 1,
      recalculatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const result = await resolveContributionRatiosForPreview(groupId, {
      useLatestRatios: false,
      includeSprintIds: ['sprint_1', 'sprint_2'],
    });

    const alice = result.students.find((student) => student.studentId === 'usr_alice');
    const bob = result.students.find((student) => student.studentId === 'usr_bob');

    expect(result.metadata.mode).toBe('explicit_sprints');
    expect(alice.contributionRatio).toBe(0.6);
    expect(alice.selectedSprintIds).toEqual(['sprint_2', 'sprint_1']);
    expect(bob.contributionRatio).toBe(0.3);
    expect(bob.selectedSprintIds).toEqual(['sprint_2', 'sprint_1']);
  });

  test('restricts latest mode to includeSprintIds when provided', async () => {
    const groupId = 'grp_ratio_latest_filtered';
    await createGroup(groupId);
    await createUser('usr_alice');
    await addApprovedMembership(groupId, 'usr_alice');

    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 0.4,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await addContribution({
      groupId,
      sprintId: 'sprint_2',
      studentId: 'usr_alice',
      contributionRatio: 0.9,
      recalculatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const result = await resolveContributionRatiosForPreview(groupId, {
      includeSprintIds: ['sprint_1'],
    });

    expect(result.students[0].contributionRatio).toBe(0.4);
    expect(result.students[0].selectedSprintIds).toEqual(['sprint_1']);
  });

  test('throws a typed 404 when an enrolled student has no ratio in scope', async () => {
    const groupId = 'grp_ratio_missing';
    await createGroup(groupId);
    await createUser('usr_alice');
    await createUser('usr_bob');
    await addApprovedMembership(groupId, 'usr_alice');
    await addApprovedMembership(groupId, 'usr_bob');
    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 0.8,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(resolveContributionRatiosForPreview(groupId, {})).rejects.toMatchObject({
      status: 404,
      code: 'MISSING_CONTRIBUTION_RATIOS',
      details: {
        missingStudentIds: ['usr_bob'],
      },
    });
  });

  test('surfaces non-blocking warnings for missing GitHub username mappings', async () => {
    const groupId = 'grp_ratio_warning';
    await createGroup(groupId);
    await createUser('usr_alice', { githubUsername: null });
    await addApprovedMembership(groupId, 'usr_alice');
    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 0.8,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await resolveContributionRatiosForPreview(groupId, {});

    expect(result.students).toHaveLength(1);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'MISSING_GITHUB_MAPPING',
        severity: 'warning',
        studentId: 'usr_alice',
      }),
    ]);
  });

  test('falls back to embedded accepted group members when membership rows are absent', async () => {
    const groupId = 'grp_ratio_embedded';
    await createGroup(groupId, {
      members: [
        { userId: 'usr_alice', role: 'leader', status: 'accepted', joinedAt: new Date() },
        { userId: 'usr_pending', role: 'member', status: 'pending' },
      ],
    });
    await createUser('usr_alice');
    await addContribution({
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 0.8,
      recalculatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await resolveContributionRatiosForPreview(groupId, {});

    expect(result.metadata.enrolledStudentCount).toBe(1);
    expect(result.students[0].studentId).toBe('usr_alice');
  });

  test('validates invalid input and invalid D6 ratio values', async () => {
    const groupId = 'grp_ratio_invalid';
    await createGroup(groupId);
    await createUser('usr_alice');
    await addApprovedMembership(groupId, 'usr_alice');

    await expect(
      resolveContributionRatiosForPreview(groupId, {
        useLatestRatios: false,
        includeSprintIds: [],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'MISSING_INCLUDE_SPRINT_IDS',
    });

    await mongoose.connection.db.collection('sprint_contributions').insertOne({
      contributionRecordId: 'ctr_invalid_ratio',
      groupId,
      sprintId: 'sprint_1',
      studentId: 'usr_alice',
      contributionRatio: 1.4,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      await resolveContributionRatiosForPreview(groupId, {});
      throw new Error('Expected invalid ratio error');
    } catch (error) {
      expect(error).toBeInstanceOf(FinalGradeRatioResolverError);
      expect(error.status).toBe(409);
      expect(error.code).toBe('INVALID_CONTRIBUTION_RATIO');
      expect(error.details.studentId).toBe('usr_alice');
    }
  });
});
