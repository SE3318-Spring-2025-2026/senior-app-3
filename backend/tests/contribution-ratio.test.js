const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const {
  recalculateSprintRatios,
  RatioServiceError
} = require('../src/services/contributionRatioService');
const ContributionRecord = require('../src/models/ContributionRecord');
const SprintRecord = require('../src/models/SprintRecord');
const SprintTarget = require('../src/models/SprintTarget');
const GroupMembership = require('../src/models/GroupMembership');
const User = require('../src/models/User');

let mongoReplSet;

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoReplSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});

beforeEach(async () => {
  await Promise.all(
    Object.keys(mongoose.connection.collections).map(async key => {
      await mongoose.connection.collections[key].deleteMany({});
    })
  );
});

async function createUser(email, role = 'student') {
  return User.create({
    email,
    hashedPassword: 'hashed-password-for-tests',
    role
  });
}

async function createSprint(groupId, overrides = {}) {
  const sprintKey = overrides.sprintKey || new mongoose.Types.ObjectId().toString();
  return SprintRecord.create({
    sprintRecordId: sprintKey,
    sprintId: sprintKey,
    groupId,
    status: 'in_progress',
    ...overrides
  });
}

async function addMembership(groupId, studentId, status = 'approved') {
  return GroupMembership.create({
    groupId,
    studentId,
    status
  });
}

async function createContribution(sprintId, groupId, studentId, completed = 0) {
  return ContributionRecord.create({
    sprintId,
    groupId,
    studentId,
    storyPointsCompleted: completed,
    storyPointsAssigned: 13,
    pullRequestsMerged: 0,
    issuesResolved: 0,
    commitsCount: 0
  });
}

async function createTarget(sprintId, groupId, studentMongoId, target = 13) {
  return SprintTarget.create({
    sprintId: new mongoose.Types.ObjectId(sprintId),
    groupId: new mongoose.Types.ObjectId(groupId),
    studentId: studentMongoId,
    targetStoryPoints: target,
    createdBy: new mongoose.Types.ObjectId()
  });
}

describe('Contribution Ratio Engine - Process 7.4', () => {
  test('TC-1: calculates and returns normalized summary', async () => {
    const coordinator = await createUser('coordinator1@example.com', 'coordinator');
    const student = await createUser('student1@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student._id.toString(), 'approved');
    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 5);
    await createContribution(sprint.sprintRecordId, groupId, student._id.toString(), 10);
    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student._id, 13);

    const result = await recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString());

    expect(result.groupId).toBe(groupId);
    expect(result.sprintId).toBe(sprint.sprintRecordId);
    expect(result.recalculatedAt).toBeDefined();
    expect(result.contributions).toHaveLength(2);
  });

  test('TC-2: ratio sum is exactly 1.0000', async () => {
    const coordinator = await createUser('coordinator2@example.com', 'coordinator');
    const student1 = await createUser('student2-1@example.com');
    const student2 = await createUser('student2-2@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student1._id.toString(), 'approved');
    await addMembership(groupId, student2._id.toString(), 'approved');

    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 3);
    await createContribution(sprint.sprintRecordId, groupId, student1._id.toString(), 8);
    await createContribution(sprint.sprintRecordId, groupId, student2._id.toString(), 13);

    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student1._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student2._id, 13);

    const result = await recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString());
    const ratioSum = result.contributions.reduce((sum, item) => sum + item.contributionRatio, 0).toFixed(4);
    expect(ratioSum).toBe('1.0000');
  });

  test('TC-3: all-zero completed points returns 422 ZERO_GROUP_TOTAL', async () => {
    const coordinator = await createUser('coordinator3@example.com', 'coordinator');
    const student = await createUser('student3@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student._id.toString(), 'approved');
    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 0);
    await createContribution(sprint.sprintRecordId, groupId, student._id.toString(), 0);
    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student._id, 13);

    await expect(
      recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString())
    ).rejects.toMatchObject({ status: 422, code: 'ZERO_GROUP_TOTAL' });
  });

  test('TC-4: locked sprint returns 409 SPRINT_LOCKED', async () => {
    const coordinator = await createUser('coordinator4@example.com', 'coordinator');
    const student = await createUser('student4@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId, { status: 'completed' });

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student._id.toString(), 'approved');
    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 5);
    await createContribution(sprint.sprintRecordId, groupId, student._id.toString(), 5);
    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student._id, 13);

    await expect(
      recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString())
    ).rejects.toMatchObject({ status: 409, code: 'SPRINT_LOCKED' });
  });

  test('TC-5: missing D8 targets returns detailed missingStudentIds', async () => {
    const coordinator = await createUser('coordinator5@example.com', 'coordinator');
    const student1 = await createUser('student5-1@example.com');
    const student2 = await createUser('student5-2@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student1._id.toString(), 'approved');
    await addMembership(groupId, student2._id.toString(), 'approved');

    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 1);
    await createContribution(sprint.sprintRecordId, groupId, student1._id.toString(), 4);
    await createContribution(sprint.sprintRecordId, groupId, student2._id.toString(), 9);

    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student1._id, 13);

    try {
      await recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString());
      fail('Expected MISSING_D8_TARGETS error');
    } catch (error) {
      expect(error).toBeInstanceOf(RatioServiceError);
      expect(error.status).toBe(422);
      expect(error.code).toBe('MISSING_D8_TARGETS');
      expect(error.details.missingStudentIds).toContain(student2._id.toString());
    }
  });

  test('TC-6: missing all D8 targets returns 422 MISSING_D8_TARGETS', async () => {
    const coordinator = await createUser('coordinator6@example.com', 'coordinator');
    const student = await createUser('student6@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student._id.toString(), 'approved');
    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 4);
    await createContribution(sprint.sprintRecordId, groupId, student._id.toString(), 8);

    await expect(
      recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString())
    ).rejects.toMatchObject({ status: 422, code: 'MISSING_D8_TARGETS' });
  });

  test('TC-7: missing attribution records triggers actionable 409 gate', async () => {
    const coordinator = await createUser('coordinator7@example.com', 'coordinator');
    const student1 = await createUser('student7-1@example.com');
    const student2 = await createUser('student7-2@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student1._id.toString(), 'approved');
    await addMembership(groupId, student2._id.toString(), 'approved');

    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 3);
    await createContribution(sprint.sprintRecordId, groupId, student1._id.toString(), 3);
    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student1._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student2._id, 13);

    try {
      await recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString());
      fail('Expected PROCESS_7_3_REQUIRED error');
    } catch (error) {
      expect(error).toBeInstanceOf(RatioServiceError);
      expect(error.status).toBe(409);
      expect(error.code).toBe('PROCESS_7_3_REQUIRED');
      expect(error.message).toMatch(/Please run GitHub\/JIRA sync first/);
      expect(error.details.missingStudentIds).toContain(student2._id.toString());
    }
  });

  test('TC-8: non-member caller is unauthorized (403)', async () => {
    const coordinator = await createUser('coordinator8@example.com', 'coordinator');
    const outsider = await createUser('outsider8@example.com', 'coordinator');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 6);
    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);

    await expect(
      recalculateSprintRatios(groupId, sprint.sprintRecordId, outsider._id.toString())
    ).rejects.toMatchObject({ status: 403, code: 'UNAUTHORIZED' });
  });

  test('TC-9: non-existent sprint returns 404 NOT_FOUND', async () => {
    const coordinator = await createUser('coordinator9@example.com', 'coordinator');
    const groupId = new mongoose.Types.ObjectId().toString();
    await addMembership(groupId, coordinator._id.toString(), 'approved');

    await expect(
      recalculateSprintRatios(groupId, new mongoose.Types.ObjectId().toString(), coordinator._id.toString())
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  test('TC-10: idempotent recalculation keeps same persisted ratios', async () => {
    const coordinator = await createUser('coordinator10@example.com', 'coordinator');
    const student = await createUser('student10@example.com');
    const groupId = new mongoose.Types.ObjectId().toString();
    const sprint = await createSprint(groupId);

    await addMembership(groupId, coordinator._id.toString(), 'approved');
    await addMembership(groupId, student._id.toString(), 'approved');
    await createContribution(sprint.sprintRecordId, groupId, coordinator._id.toString(), 4);
    await createContribution(sprint.sprintRecordId, groupId, student._id.toString(), 12);
    await createTarget(sprint.sprintRecordId, groupId, coordinator._id, 13);
    await createTarget(sprint.sprintRecordId, groupId, student._id, 13);

    const first = await recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString());
    const second = await recalculateSprintRatios(groupId, sprint.sprintRecordId, coordinator._id.toString());

    expect(first.summary.normalizationFactor).toBe('1.0000');
    expect(second.summary.normalizationFactor).toBe('1.0000');

    const records = await ContributionRecord.find({ groupId, sprintId: sprint.sprintRecordId });
    expect(records).toHaveLength(2);
    const sum = records.reduce((acc, item) => acc + item.contributionRatio, 0).toFixed(4);
    expect(sum).toBe('1.0000');
  });
});
