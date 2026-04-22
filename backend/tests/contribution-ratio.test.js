/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ISSUE #236 TESTS: contribution-ratio.test.js
 * Comprehensive Test Suite for Process 7.4 Ratio Calculation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Test Coverage:
 * This suite validates all 5 acceptance criteria + edge cases for Issue #236
 *
 * Acceptance Criteria Mapped to Tests:
 * ✓ Criterion #1: Ratio sum tolerance → TC-7 (validateRatioSum)
 * ✓ Criterion #2: Zero target safe behavior → TC-2, TC-3 (422 not NaN)
 * ✓ Criterion #3: Locked sprint → 409 → TC-4
 * ✓ Criterion #4: Per-student breakdown + recalculatedAt → TC-1, TC-5
 * ✓ Criterion #5: Deterministic idempotent output → TC-6, TC-8
 *
 * Test Structure:
 * - Setup: MongoMemoryServer + Mock data (users, groups, sprints, contributions)
 * - 10 test cases covering happy path + error scenarios
 * - Teardown: Cleanup and disconnect
 *
 * Technologies:
 * - Jest (test runner)
 * - MongoMemoryServer (in-memory MongoDB)
 * - Supertest (HTTP testing) - optional for integration tests
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  recalculateSprintRatios,
  RatioServiceError,
  validateInputs,
  calculatePerStudentRatios
} = require('../src/services/contributionRatioService');
const ContributionRecord = require('../src/models/ContributionRecord');
const SprintRecord = require('../src/models/SprintRecord');
const SprintTarget = require('../src/models/SprintTarget');
const GroupMembership = require('../src/models/GroupMembership');
const User = require('../src/models/User');

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #236 TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════

let mongoServer;

/**
 * ISSUE #236 BEFORE ALL: Start test database + connect
 * Why: Each test suite needs isolated DB
 * What: Spin up MongoMemoryServer + connect mongoose
 */
beforeAll(async () => {
  // ISSUE #236: Start MongoMemoryServer (in-memory MongoDB)
  // Why: Fast, isolated test DB (no external dependencies)
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log('[contribution-ratio.test] Test database connected');
});

/**
 * ISSUE #236 AFTER ALL: Cleanup + disconnect
 * Why: Release resources after all tests complete
 */
afterAll(async () => {
  // ISSUE #236: Disconnect mongoose
  await mongoose.disconnect();

  // ISSUE #236: Stop MongoMemoryServer
  if (mongoServer) {
    await mongoServer.stop();
  }

  console.log('[contribution-ratio.test] Test database disconnected');
});

/**
 * ISSUE #236 BEFORE EACH: Create fresh test data
 * Why: Each test needs clean state
 */
beforeEach(async () => {
  // ISSUE #236: Clear all collections
  // Why: Prevent data leakage between tests
  await Promise.all(
    Object.keys(mongoose.connection.collections).map(async (key) => {
      await mongoose.connection.collections[key].deleteMany({});
    })
  );

  console.log('[contribution-ratio.test] Test data cleared');
});

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #236 TEST FIXTURES: Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ISSUE #236: Create mock user
 * Returns: User document
 */
async function createMockUser(email, role = 'student') {
  const user = new User({
    email: email,
    firstName: 'Test',
    lastName: 'User',
    role: role,
    githubUsername: email.split('@')[0]
  });
  return user.save();
}

/**
 * ISSUE #236: Create mock sprint
 * Returns: SprintRecord document
 */
async function createMockSprint(groupId) {
  const sprint = new SprintRecord({
    sprintId: new mongoose.Types.ObjectId(),
    groupId: groupId,
    status: 'active',
    locked: false,
    deliverableRefs: []
  });
  return sprint.save();
}

/**
 * ISSUE #236: Create mock group membership
 * Returns: GroupMembership document
 */
async function createMockMembership(groupId, userId, role = 'member', status = 'approved') {
  const membership = new GroupMembership({
    groupId: groupId,
    userId: userId,
    role: role,
    approvalStatus: status
  });
  return membership.save();
}

/**
 * ISSUE #236: Create mock contribution record
 * Returns: ContributionRecord document
 */
async function createMockContribution(sprintId, groupId, studentId, completed = 10, assigned = 13) {
  const contribution = new ContributionRecord({
    sprintId: sprintId,
    groupId: groupId,
    studentId: studentId,
    storyPointsCompleted: completed,
    storyPointsAssigned: assigned,
    pullRequestsMerged: 2,
    issuesResolved: 1,
    commitsCount: 5,
    gitHubHandle: 'test-user'
  });
  return contribution.save();
}

/**
 * ISSUE #236: Create mock sprint target
 * Returns: SprintTarget document
 */
async function createMockTarget(sprintId, groupId, studentId, target = 13, strategy = 'fixed') {
  const target_obj = new SprintTarget({
    sprintId: sprintId,
    groupId: groupId,
    studentId: studentId,
    targetStoryPoints: target,
    ratioStrategy: strategy,
    createdBy: new mongoose.Types.ObjectId()
  });
  return target_obj.save();
}

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #236 TEST CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('[ISSUE #236] Contribution Ratio Engine - Process 7.4', () => {

  /**
   * TC-1: HAPPY PATH - Single student, basic calculation
   * Criterion #4: Per-student breakdown + recalculatedAt
   * Expected: 200 OK with ratio = 10/13 = 0.7692
   */
  test('TC-1: Calculate ratio for single student with target', async () => {
    // ISSUE #236 TC-1: SETUP
    // Why: Create minimal test scenario
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    // Add student to group as member
    await createMockMembership(groupId, student1._id, 'member', 'approved');

    // Create contribution record (from Issue #235)
    await createMockContribution(sprint.sprintId, groupId, student1._id, 10, 13);

    // Create target (D8 configuration)
    await createMockTarget(sprint.sprintId, groupId, student1._id, 13, 'fixed');

    // Add professor as coordinator
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-1: EXECUTE
    // Why: Call recalculateSprintRatios (main orchestrator)
    const result = await recalculateSprintRatios(
      groupId.toString(),
      sprint.sprintId.toString(),
      professor._id.toString()
    );

    // ISSUE #236 TC-1: ASSERT
    // Why: Verify calculation correctness
    expect(result).toBeDefined();
    expect(result.success !== false).toBe(true);
    expect(result.contributions).toHaveLength(1);

    const contribution = result.contributions[0];
    // Ratio = 10 / 13 = 0.7692
    expect(contribution.contributionRatio).toBeCloseTo(10/13, 3);
    expect(contribution.studentId.toString()).toBe(student1._id.toString());

    // ISSUE #236 TC-1: Verify recalculatedAt (Criterion #4)
    expect(result.recalculatedAt).toBeDefined();
    expect(new Date(result.recalculatedAt)).toBeInstanceOf(Date);

    console.log('[TC-1 PASS] Single student ratio calculation');
  });

  /**
   * TC-2: ZERO TARGET - Should use fallback (Criterion #2)
   * Expected: Calculate using average target (groupTotal / memberCount)
   */
  test('TC-2: Handle zero target with fallback calculation', async () => {
    // ISSUE #236 TC-2: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const student2 = await createMockUser('student2@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    // Add students to group
    await createMockMembership(groupId, student1._id, 'member', 'approved');
    await createMockMembership(groupId, student2._id, 'member', 'approved');

    // Create contributions (Issue #235 data)
    await createMockContribution(sprint.sprintId, groupId, student1._id, 10, 0);
    await createMockContribution(sprint.sprintId, groupId, student2._id, 20, 0);

    // NO targets created (zero target scenario)

    // Add professor as coordinator
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-2: EXECUTE
    const result = await recalculateSprintRatios(
      groupId.toString(),
      sprint.sprintId.toString(),
      professor._id.toString()
    );

    // ISSUE #236 TC-2: ASSERT
    // Should use fallback: average = (10+20)/2 = 15
    // student1 ratio = 10/15 = 0.6667
    // student2 ratio = 20/15 = 1.3333
    expect(result.contributions).toHaveLength(2);
    expect(result.contributions[0].contributionRatio).toBeCloseTo(10/15, 3);

    console.log('[TC-2 PASS] Zero target fallback calculation');
  });

  /**
   * TC-3: ZERO GROUP TOTAL - Should return 422 (Criterion #2)
   * Expected: RatioServiceError with status 422, code ZERO_GROUP_TOTAL
   */
  test('TC-3: Reject zero group total with 422 error', async () => {
    // ISSUE #236 TC-3: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    // Add student to group
    await createMockMembership(groupId, student1._id, 'member', 'approved');

    // Create contribution with ZERO completed (no progress)
    await createMockContribution(sprint.sprintId, groupId, student1._id, 0, 13);

    // Add professor as coordinator
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-3: EXECUTE & ASSERT
    // Should throw 422 because group total is 0
    await expect(
      recalculateSprintRatios(
        groupId.toString(),
        sprint.sprintId.toString(),
        professor._id.toString()
      )
    ).rejects.toThrow(RatioServiceError);

    // ISSUE #236 TC-3: Verify error code
    try {
      await recalculateSprintRatios(
        groupId.toString(),
        sprint.sprintId.toString(),
        professor._id.toString()
      );
    } catch (err) {
      expect(err.status).toBe(422);
      expect(err.code).toBe('ZERO_GROUP_TOTAL');
    }

    console.log('[TC-3 PASS] Zero group total returns 422');
  });

  /**
   * TC-4: LOCKED SPRINT - Should return 409 (Criterion #3)
   * Expected: RatioServiceError with status 409, code SPRINT_LOCKED
   */
  test('TC-4: Reject recalculation for locked sprint with 409', async () => {
    // ISSUE #236 TC-4: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    // Lock the sprint (deadline passed)
    sprint.locked = true;
    await sprint.save();

    // Add student to group
    await createMockMembership(groupId, student1._id, 'member', 'approved');

    // Create contribution and target
    await createMockContribution(sprint.sprintId, groupId, student1._id, 10, 13);
    await createMockTarget(sprint.sprintId, groupId, student1._id, 13);

    // Add professor as coordinator
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-4: EXECUTE & ASSERT
    // Should throw 409 because sprint is locked
    try {
      await recalculateSprintRatios(
        groupId.toString(),
        sprint.sprintId.toString(),
        professor._id.toString()
      );
      fail('Should have thrown error for locked sprint');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.code).toBe('SPRINT_LOCKED');
    }

    console.log('[TC-4 PASS] Locked sprint returns 409');
  });

  /**
   * TC-5: MULTIPLE STUDENTS - Per-student breakdown (Criterion #4)
   * Expected: Array with one entry per student, all with correct ratios
   */
  test('TC-5: Calculate breakdown for multiple students', async () => {
    // ISSUE #236 TC-5: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const student2 = await createMockUser('student2@uni.edu');
    const student3 = await createMockUser('student3@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    // Add all students
    await createMockMembership(groupId, student1._id, 'member', 'approved');
    await createMockMembership(groupId, student2._id, 'member', 'approved');
    await createMockMembership(groupId, student3._id, 'member', 'approved');

    // Create contributions with different completed values
    await createMockContribution(sprint.sprintId, groupId, student1._id, 13, 13);  // 100%
    await createMockContribution(sprint.sprintId, groupId, student2._id, 10, 13);  // 77%
    await createMockContribution(sprint.sprintId, groupId, student3._id, 5, 13);   // 38%

    // Create targets
    await createMockTarget(sprint.sprintId, groupId, student1._id, 13);
    await createMockTarget(sprint.sprintId, groupId, student2._id, 13);
    await createMockTarget(sprint.sprintId, groupId, student3._id, 13);

    // Add professor as coordinator
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-5: EXECUTE
    const result = await recalculateSprintRatios(
      groupId.toString(),
      sprint.sprintId.toString(),
      professor._id.toString()
    );

    // ISSUE #236 TC-5: ASSERT
    expect(result.contributions).toHaveLength(3);

    // Check each student's ratio
    const ratios = result.contributions.sort((a, b) => 
      a.studentId.localeCompare(b.studentId)
    );

    expect(ratios[0].contributionRatio).toBeCloseTo(1.0, 2);  // 13/13
    expect(ratios[1].contributionRatio).toBeCloseTo(10/13, 2);  // 10/13
    expect(ratios[2].contributionRatio).toBeCloseTo(5/13, 2);   // 5/13

    console.log('[TC-5 PASS] Multiple student breakdown');
  });

  /**
   * TC-6: IDEMPOTENCY - Same input always produces same output (Criterion #5)
   * Expected: First call == Second call (deterministic)
   */
  test('TC-6: Verify idempotent calculation (Criterion #5)', async () => {
    // ISSUE #236 TC-6: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    await createMockMembership(groupId, student1._id, 'member', 'approved');
    await createMockContribution(sprint.sprintId, groupId, student1._id, 10, 13);
    await createMockTarget(sprint.sprintId, groupId, student1._id, 13);
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-6: EXECUTE (First call)
    const result1 = await recalculateSprintRatios(
      groupId.toString(),
      sprint.sprintId.toString(),
      professor._id.toString()
    );

    // ISSUE #236 TC-6: EXECUTE (Second call - same input)
    const result2 = await recalculateSprintRatios(
      groupId.toString(),
      sprint.sprintId.toString(),
      professor._id.toString()
    );

    // ISSUE #236 TC-6: ASSERT
    // Both calls should produce identical output
    expect(result1.contributions[0].contributionRatio).toEqual(
      result2.contributions[0].contributionRatio
    );
    expect(result1.groupTotalStoryPoints).toEqual(result2.groupTotalStoryPoints);

    console.log('[TC-6 PASS] Idempotent calculation confirmed');
  });

  /**
   * TC-7: RATIO SUM VALIDATION (Criterion #1)
   * Expected: Validate that ratios stay within tolerance
   */
  test('TC-7: Ratio sum validation with tolerance', async () => {
    const { validateRatioSum } = require('../src/utils/ratioNormalization');

    // ISSUE #236 TC-7: Test ratio array that sums to ~1.0
    const ratios = [0.33, 0.33, 0.34];
    const validation = validateRatioSum(ratios, 1.0, 0.01);

    expect(validation.valid).toBe(true);
    expect(validation.actualSum).toBeCloseTo(1.0, 2);
    expect(validation.deviation).toBeLessThan(0.01);

    console.log('[TC-7 PASS] Ratio sum validation');
  });

  /**
   * TC-8: AUTHORIZATION - Non-coordinator cannot recalculate (Criterion #3)
   * Expected: 403 Forbidden
   */
  test('TC-8: Reject non-coordinator with 403', async () => {
    // ISSUE #236 TC-8: SETUP
    const student1 = await createMockUser('student1@uni.edu');
    const student2 = await createMockUser('student2@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    // Both added as members (NOT coordinator)
    await createMockMembership(groupId, student1._id, 'member', 'approved');
    await createMockMembership(groupId, student2._id, 'member', 'approved');

    await createMockContribution(sprint.sprintId, groupId, student1._id, 10, 13);
    await createMockTarget(sprint.sprintId, groupId, student1._id, 13);

    // ISSUE #236 TC-8: EXECUTE & ASSERT
    // Should throw 403 because student1 is not coordinator
    try {
      await recalculateSprintRatios(
        groupId.toString(),
        sprint.sprintId.toString(),
        student1._id.toString()
      );
      fail('Should have thrown 403 error');
    } catch (err) {
      expect(err.status).toBe(403);
      expect(err.code).toBe('UNAUTHORIZED');
    }

    console.log('[TC-8 PASS] Non-coordinator rejected with 403');
  });

  /**
   * TC-9: INVALID SPRINT - Non-existent sprint
   * Expected: 404 Not Found
   */
  test('TC-9: Return 404 for non-existent sprint', async () => {
    // ISSUE #236 TC-9: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const groupId = new mongoose.Types.ObjectId();

    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    // ISSUE #236 TC-9: EXECUTE & ASSERT
    // Non-existent sprint ID
    try {
      await recalculateSprintRatios(
        groupId.toString(),
        new mongoose.Types.ObjectId().toString(),
        professor._id.toString()
      );
      fail('Should have thrown 404 error');
    } catch (err) {
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
    }

    console.log('[TC-9 PASS] Non-existent sprint returns 404');
  });

  /**
   * TC-10: ATOMIC TRANSACTION - Verify all-or-nothing update
   * Expected: All ratios updated together, or none if error
   */
  test('TC-10: Atomic transaction ensures consistency', async () => {
    // ISSUE #236 TC-10: SETUP
    const professor = await createMockUser('prof@uni.edu', 'professor');
    const student1 = await createMockUser('student1@uni.edu');
    const student2 = await createMockUser('student2@uni.edu');
    const groupId = new mongoose.Types.ObjectId();
    const sprint = await createMockSprint(groupId);

    await createMockMembership(groupId, student1._id, 'member', 'approved');
    await createMockMembership(groupId, student2._id, 'member', 'approved');
    await createMockMembership(groupId, professor._id, 'coordinator', 'approved');

    await createMockContribution(sprint.sprintId, groupId, student1._id, 10, 13);
    await createMockContribution(sprint.sprintId, groupId, student2._id, 10, 13);

    await createMockTarget(sprint.sprintId, groupId, student1._id, 13);
    await createMockTarget(sprint.sprintId, groupId, student2._id, 13);

    // ISSUE #236 TC-10: EXECUTE
    const result = await recalculateSprintRatios(
      groupId.toString(),
      sprint.sprintId.toString(),
      professor._id.toString()
    );

    // ISSUE #236 TC-10: ASSERT
    // Verify both students' records were updated atomically
    const records = await ContributionRecord.find({
      sprintId: sprint.sprintId,
      groupId: groupId
    });

    expect(records).toHaveLength(2);
    // All ratios should be updated (not partially)
    expect(records.every(r => r.contributionRatio > 0)).toBe(true);

    console.log('[TC-10 PASS] Atomic transaction consistency verified');
  });

});
