'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #235 TEST SUITE: attributionService.test.js
 * Test coverage for GitHub PR author → studentId mapping and attribution logic
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Acceptance Criteria (from Issue #235):
 * ✓ Only merged PR-linked issues contribute completed story points
 * ✓ Students not in the group cannot receive attribution for the group's sprint
 * ✓ Unmapped GitHub activity is logged with issue_key and PR identifiers
 * ✓ Attribution output is deterministic for the same inputs (idempotent mapping)
 * ✓ Partial merges do not count completed story points
 */

const mongoose = require('mongoose');
const { attributeStoryPoints, mapGitHubToStudent } = require('../src/services/attributionService');
const User = require('../src/models/User');
const GroupMembership = require('../src/models/GroupMembership');
const ContributionRecord = require('../src/models/ContributionRecord');
const SprintRecord = require('../src/models/SprintRecord');
const GitHubSyncJob = require('../src/models/GitHubSyncJob');
const Group = require('../src/models/Group');

// Jest test setup (assumes jest + test database)
describe('attributionService — ISSUE #235 Tests', () => {
  let testGroupId, testSprintId, testStudentId1, testStudentId2;

  beforeAll(async () => {
    // Connect to test database (assumes jest.config.js sets MONGODB_URI_TEST)
    if (!mongoose.connection.readyState) {
      await mongoose.connect(process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/test-db');
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await Promise.all([
      User.deleteMany({}),
      GroupMembership.deleteMany({}),
      ContributionRecord.deleteMany({}),
      SprintRecord.deleteMany({}),
      GitHubSyncJob.deleteMany({}),
      Group.deleteMany({}),
    ]);

    // Setup test fixtures
    testGroupId = 'grp_test123';
    testSprintId = 'sprint_test456';
    testStudentId1 = 'stud_john_001';
    testStudentId2 = 'stud_jane_001';

    // Create test group
    await Group.create({
      groupId: testGroupId,
      name: 'Test Group',
      useJiraAssigneeForAttribution: false,
    });

    // Create test users with GitHub usernames
    await User.create([
      {
        userId: 'usr_1',
        email: 'john@example.com',
        hashedPassword: 'hashed',
        studentId: testStudentId1,
        githubUsername: 'john-doe', // ← D1 mapping
        role: 'student',
      },
      {
        userId: 'usr_2',
        email: 'jane@example.com',
        hashedPassword: 'hashed',
        studentId: testStudentId2,
        githubUsername: 'jane-smith', // ← D1 mapping
        role: 'student',
      },
      {
        userId: 'usr_3',
        email: 'bob@example.com',
        hashedPassword: 'hashed',
        studentId: 'stud_bob_001',
        githubUsername: 'bob-notingroup', // ← NOT in group
        role: 'student',
      },
    ]);

    // Create group memberships (D2)
    // john-doe: approved
    // jane-smith: approved
    // bob-notingroup: NOT in group
    await GroupMembership.create([
      {
        groupId: testGroupId,
        studentId: testStudentId1,
        status: 'approved',
      },
      {
        groupId: testGroupId,
        studentId: testStudentId2,
        status: 'approved',
      },
      // Note: bob-notingroup is NOT added to group
    ]);

    // Create sprint record
    await SprintRecord.create({
      sprintId: testSprintId,
      groupId: testGroupId,
      status: 'pending',
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 1: Merged PR with matched student
  // ═════════════════════════════════════════════════════════════════════════════
  // Acceptance Criteria: "Only merged PR-linked issues contribute completed story points"

  it('TC-1: Should attribute story points for merged PR with matched GitHub author in group', async () => {
    console.log('\n[TEST] TC-1: Merged PR with matched student');

    // Create GitHub sync job with MERGED issue from john-doe
    await GitHubSyncJob.create({
      jobId: 'ghsync_tc1_001',
      groupId: testGroupId,
      sprintId: testSprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'PROJ-001',
          prId: '123',
          prUrl: 'https://github.com/org/repo/pull/123',
          prAuthor: 'john-doe', // ← Maps to testStudentId1
          mergeStatus: 'MERGED', // ← KEY: merged
          storyPoints: 5,
          lastValidated: new Date(),
        },
      ],
    });

    const result = await attributeStoryPoints(testSprintId, testGroupId);

    // ASSERTIONS
    expect(result.attributedStudents).toBe(1);
    expect(result.totalStoryPoints).toBe(5);
    expect(result.unattributableCount).toBe(0);
    expect(result.attributionDetails[0].studentId).toBe(testStudentId1);
    expect(result.attributionDetails[0].completedPoints).toBe(5);
    expect(result.attributionDetails[0].decisionReason).toBe('ATTRIBUTED_VIA_GITHUB_AUTHOR');

    // Verify ContributionRecord created
    const contributionRecord = await ContributionRecord.findOne({
      sprintId: testSprintId,
      studentId: testStudentId1,
      groupId: testGroupId,
    });
    expect(contributionRecord).toBeDefined();
    expect(contributionRecord.storyPointsCompleted).toBe(5);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 2: Student NOT in group
  // ═════════════════════════════════════════════════════════════════════════════
  // Acceptance Criteria: "Students not in the group cannot receive attribution for the group's sprint"

  it('TC-2: Should reject attribution for GitHub author not in group', async () => {
    console.log('\n[TEST] TC-2: Student not in group');

    // Create GitHub sync job with MERGED issue from bob-notingroup
    await GitHubSyncJob.create({
      jobId: 'ghsync_tc2_001',
      groupId: testGroupId,
      sprintId: testSprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'PROJ-002',
          prId: '124',
          mergeStatus: 'MERGED',
          prAuthor: 'bob-notingroup', // ← D1 has user, but NOT in D2 group
          storyPoints: 3,
        },
      ],
    });

    const result = await attributeStoryPoints(testSprintId, testGroupId);

    // ASSERTIONS
    expect(result.attributedStudents).toBe(0);
    expect(result.unattributableCount).toBe(1);
    expect(result.unattributablePoints).toBe(3);
    expect(result.attributionDetails[0].decisionReason).toBe('REJECTED_NOT_IN_GROUP');
    expect(result.warnings.some((w) => w.reason === 'GITHUB_AUTHOR_NOT_IN_GROUP')).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 3: Partial merge (NOT_MERGED status)
  // ═════════════════════════════════════════════════════════════════════════════
  // Acceptance Criteria: "Partial merges do not count completed story points"

  it('TC-3: Should not attribute story points for NOT_MERGED PR', async () => {
    console.log('\n[TEST] TC-3: Partial merge (NOT_MERGED)');

    // Create GitHub sync job with NOT_MERGED issue
    await GitHubSyncJob.create({
      jobId: 'ghsync_tc3_001',
      groupId: testGroupId,
      sprintId: testSprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'PROJ-003',
          prId: '125',
          mergeStatus: 'NOT_MERGED', // ← KEY: not merged
          prAuthor: 'john-doe',
          storyPoints: 5,
        },
      ],
    });

    const result = await attributeStoryPoints(testSprintId, testGroupId);

    // ASSERTIONS
    expect(result.attributedStudents).toBe(0); // ← NOT attributed
    expect(result.totalStoryPoints).toBe(0); // ← NO story points
    expect(result.unattributableCount).toBe(0); // ← Not counted as unattributable (skipped)
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 4: GitHub username not in D1
  // ═════════════════════════════════════════════════════════════════════════════
  // Acceptance Criteria: "Unmapped GitHub activity is logged with issue_key and PR identifiers"

  it('TC-4: Should mark unattributable for unknown GitHub username', async () => {
    console.log('\n[TEST] TC-4: GitHub username not found in D1');

    // Create GitHub sync job with unknown GitHub author
    await GitHubSyncJob.create({
      jobId: 'ghsync_tc4_001',
      groupId: testGroupId,
      sprintId: testSprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'PROJ-004',
          prId: '126',
          mergeStatus: 'MERGED',
          prAuthor: 'unknown-user-xyz', // ← NOT in D1
          storyPoints: 4,
        },
      ],
    });

    const result = await attributeStoryPoints(testSprintId, testGroupId);

    // ASSERTIONS
    expect(result.attributedStudents).toBe(0);
    expect(result.unattributableCount).toBe(1);
    expect(result.unattributablePoints).toBe(4);
    expect(result.warnings.some((w) => w.reason === 'GITHUB_AUTHOR_NOT_IN_D1')).toBe(true);
    expect(result.warnings[0].issue_key).toBe('PROJ-004');
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 5: Multiple students, mixed results
  // ═════════════════════════════════════════════════════════════════════════════

  it('TC-5: Should handle multiple issues with mixed attribution outcomes', async () => {
    console.log('\n[TEST] TC-5: Multiple issues with mixed results');

    // Create GitHub sync job with multiple issues
    await GitHubSyncJob.create({
      jobId: 'ghsync_tc5_001',
      groupId: testGroupId,
      sprintId: testSprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'PROJ-005',
          mergeStatus: 'MERGED',
          prAuthor: 'john-doe', // ← Should attribute
          storyPoints: 5,
        },
        {
          issueKey: 'PROJ-006',
          mergeStatus: 'MERGED',
          prAuthor: 'jane-smith', // ← Should attribute
          storyPoints: 3,
        },
        {
          issueKey: 'PROJ-007',
          mergeStatus: 'MERGED',
          prAuthor: 'unknown-user', // ← Should be unattributable
          storyPoints: 2,
        },
      ],
    });

    const result = await attributeStoryPoints(testSprintId, testGroupId);

    // ASSERTIONS
    expect(result.attributedStudents).toBe(2); // john + jane
    expect(result.totalStoryPoints).toBe(8); // 5 + 3
    expect(result.unattributableCount).toBe(1); // unknown-user
    expect(result.unattributablePoints).toBe(2);

    // Verify ContributionRecords
    const john = await ContributionRecord.findOne({
      sprintId: testSprintId,
      studentId: testStudentId1,
    });
    expect(john.storyPointsCompleted).toBe(5);

    const jane = await ContributionRecord.findOne({
      sprintId: testSprintId,
      studentId: testStudentId2,
    });
    expect(jane.storyPointsCompleted).toBe(3);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 6: Idempotency (same input = same output)
  // ═════════════════════════════════════════════════════════════════════════════
  // Acceptance Criteria: "Attribution output is deterministic for the same inputs (idempotent mapping)"

  it('TC-6: Should produce identical results on second run (idempotent)', async () => {
    console.log('\n[TEST] TC-6: Idempotent re-run');

    // Create GitHub sync job
    await GitHubSyncJob.create({
      jobId: 'ghsync_tc6_001',
      groupId: testGroupId,
      sprintId: testSprintId,
      status: 'COMPLETED',
      validationRecords: [
        {
          issueKey: 'PROJ-008',
          mergeStatus: 'MERGED',
          prAuthor: 'john-doe',
          storyPoints: 5,
        },
      ],
    });

    // First run
    const result1 = await attributeStoryPoints(testSprintId, testGroupId);

    // Second run (should produce identical results)
    const result2 = await attributeStoryPoints(testSprintId, testGroupId);

    // ASSERTIONS
    expect(result1.attributedStudents).toBe(result2.attributedStudents);
    expect(result1.totalStoryPoints).toBe(result2.totalStoryPoints);
    expect(result1.unattributablePoints).toBe(result2.unattributablePoints);

    // Verify only one ContributionRecord exists (not duplicated)
    const records = await ContributionRecord.find({
      sprintId: testSprintId,
      studentId: testStudentId1,
    });
    expect(records.length).toBe(1); // ← Not duplicated
    expect(records[0].storyPointsCompleted).toBe(5);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 7: mapGitHubToStudent utility
  // ═════════════════════════════════════════════════════════════════════════════

  it('TC-7: mapGitHubToStudent should return studentId for approved members', async () => {
    console.log('\n[TEST] TC-7: mapGitHubToStudent utility');

    // Test approved member
    const result1 = await mapGitHubToStudent('john-doe', testGroupId);
    expect(result1).toBe(testStudentId1);

    // Test non-group member
    const result2 = await mapGitHubToStudent('bob-notingroup', testGroupId);
    expect(result2).toBeNull();

    // Test unknown GitHub username
    const result3 = await mapGitHubToStudent('unknown-xyz', testGroupId);
    expect(result3).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // TEST 8: No GitHub sync data
  // ═════════════════════════════════════════════════════════════════════════════

  it('TC-8: Should return empty result when no GitHub sync job exists', async () => {
    console.log('\n[TEST] TC-8: No GitHub sync data');

    // Don't create any GitHubSyncJob
    const result = await attributeStoryPoints(testSprintId, testGroupId);

    expect(result.attributedStudents).toBe(0);
    expect(result.totalStoryPoints).toBe(0);
    expect(result.warnings.some((w) => w.reason === 'NO_GITHUB_SYNC_DATA')).toBe(true);
  });
});

describe('attributionService — Edge Cases', () => {
  // Additional edge case tests...
  // (Case-insensitive GitHub username matching, JIRA fallback, etc.)

  it('Edge Case 1: GitHub username case-insensitive matching', async () => {
    // TODO: Test JOHN-DOE vs john-doe
  });

  it('Edge Case 2: JIRA assignee fallback (when enabled)', async () => {
    // TODO: Test useJiraFallback option
  });
});
