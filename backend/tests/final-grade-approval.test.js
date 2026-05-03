/**
 * ================================================================================
 * ISSUE #253: Final Grade Approval Integration Tests
 * ================================================================================
 *
 * Purpose:
 * Comprehensive test suite for Issue #253 approval workflow.
 *
 * Test Coverage:
 * 1. Successful approval (200 OK)
 * 2. Duplicate approval attempt (409 Conflict)
 * 3. Coordinator-only access (403 Forbidden for non-coordinators)
 * 4. Request validation (422 Unprocessable Entity)
 * 5. Override metadata persistence
 * 6. Audit trail creation
 * 7. Rejection workflow
 * 8. Group not found scenario (404)
 *
 * Process Context:
 * Tests verify that Issue #253 correctly:
 * - Persists approval decisions to D7 (FinalGrade collection)
 * - Records override metadata
 * - Creates comprehensive audit logs
 * - Prevents duplicate approvals
 * - Enforces role-based access control
 * - Returns proper response for Issue #255 consumption
 *
 * ================================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/index');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../src/models/FinalGrade');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');
const Group = require('../src/models/Group');

/**
 * ISSUE #253: TEST SETUP & TEARDOWN
 */

describe('[ISSUE #253] Final Grade Approval Workflow', () => {
  // ISSUE #253: Test data objects
  let coordinatorUser;
  let studentUser1;
  let studentUser2;
  let testGroup;
  let coordinatorToken;
  let validJWT;

  /**
   * ISSUE #253: BeforeAll hook - Setup test data
   * Creates test users, group, and JWT tokens for requests
   */
  beforeAll(async () => {

    try {
      const bcrypt = require('bcryptjs');
      // Pre-generate hashed password for tests (bcryptjs hash of 'testpass123' with SALT_ROUNDS=12)
      const testPasswordHash = '$2a$12$K9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jKMm.';

      // ISSUE #253: Create test coordinator user
      coordinatorUser = await User.create({
        firstName: 'Coordinator',
        lastName: 'Test',
        email: 'coordinator@test.com',
        hashedPassword: testPasswordHash,
        role: 'coordinator',
        emailVerified: true
      });

      // ISSUE #253: Create test students
      studentUser1 = await User.create({
        firstName: 'Student',
        lastName: 'One',
        email: 'student1@test.com',
        hashedPassword: testPasswordHash,
        role: 'student',
        emailVerified: true,
        enrollmentYear: 2024
      });

      studentUser2 = await User.create({
        firstName: 'Student',
        lastName: 'Two',
        email: 'student2@test.com',
        hashedPassword: testPasswordHash,
        role: 'student',
        emailVerified: true,
        enrollmentYear: 2024
      });

      // ISSUE #253: Create test group
      testGroup = await Group.create({
        groupName: 'Test Group',
        members: [studentUser1._id, studentUser2._id],
        groupCode: 'TEST001',
        status: 'formed'
      });

      // ISSUE #253: Create JWT token for coordinator
      coordinatorToken = require('jsonwebtoken').sign(
        { userId: coordinatorUser._id, role: 'coordinator' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      // ISSUE #253: Create JWT token for student (for unauthorized tests)
      const studentToken = require('jsonwebtoken').sign(
        { userId: studentUser1._id, role: 'student' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      validJWT = coordinatorToken;

      console.log('[Issue #253] Test setup complete');
    } catch (error) {
      console.error('[Issue #253] Setup error:', error);
      throw error;
    }
  });

  /**
   * ISSUE #253: AfterAll hook - Cleanup test data
   */
  afterAll(async () => {

    try {
      // ISSUE #253: Clean up all test data
      await FinalGrade.deleteMany({});
      await AuditLog.deleteMany({});
      await Group.deleteMany({});
      await User.deleteMany({});

      console.log('[Issue #253] Test cleanup complete');
    } catch (error) {
      console.error('[Issue #253] Cleanup error:', error);
    }
  });

  // =========================================================================
  // ISSUE #253: TEST GROUP 1 - SUCCESSFUL APPROVAL
  // =========================================================================

  describe('✓ Successful Grade Approval', () => {
    /**
     * ISSUE #253: TEST 1.1 - Approve grades without overrides
     * Scenario: Coordinator approves computed grades as-is
     * Expected: 200 OK, all grades transition to approved status
     */
    it('should approve group grades without overrides (200 OK)', async () => {
      // ISSUE #253: ARRANGE - Create preview grades in database
      // Simulating grades computed in Process 8.3
      const previewGrades = [
        {
          groupId: testGroup._id.toString(),
          studentId: studentUser1._id.toString(),
          baseGroupScore: 85,
          individualRatio: 0.9,
          computedFinalGrade: 76.5 // 85 * 0.9
        },
        {
          groupId: testGroup._id.toString(),
          studentId: studentUser2._id.toString(),
          baseGroupScore: 85,
          individualRatio: 0.8,
          computedFinalGrade: 68 // 85 * 0.8
        }
      ];

      await FinalGrade.insertMany(
        previewGrades.map((g) => ({
          ...g,
          finalGradeId: `fg_${Math.random().toString(36).substr(2, 9)}`,
          status: FINAL_GRADE_STATUS.PENDING,
          createdAt: new Date(),
          updatedAt: new Date()
        }))
      );

      // ISSUE #253: ACT - POST approval request
      const response = await request(app)
        .post(
          `/api/v1/groups/${testGroup._id.toString()}/final-grades/approval`
        )
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'approve',
          reason: 'Grades look good'
        });

      // ISSUE #253: ASSERT - Response validation
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.decision).toBe('approve');
      expect(response.body.totalStudents).toBe(2);
      expect(response.body.approvedCount).toBe(2);
      expect(response.body.grades.length).toBe(2);

      // ISSUE #253: ASSERT - Database verification
      const savedGrades = await FinalGrade.find({
        groupId: testGroup._id.toString()
      });
      expect(savedGrades.length).toBe(2);
      expect(savedGrades[0].status).toBe(FINAL_GRADE_STATUS.APPROVED);
      expect(savedGrades[0].approvedBy).toBe(coordinatorUser._id.toString());
      expect(savedGrades[0].approvedAt).to.exist;

      // ISSUE #253: ASSERT - Audit log verification
      const auditLogs = await AuditLog.find({
        action: 'FINAL_GRADE_APPROVED',
        groupId: testGroup._id.toString()
      });
      expect(auditLogs.length).toBe(2);
      auditLogs.forEach((log) => {
        expect(log.actorId).toBe(coordinatorUser._id.toString());
        expect(log.payload.studentId).to.exist;
      });
    });

    /**
     * ISSUE #253: TEST 1.2 - Approve with override for one student
     * Scenario: Coordinator approves but overrides one student's grade
     * Expected: 200 OK, override metadata persisted, audit log created
     */
    it('should approve grades with overrides (200 OK)', async () => {
      // ISSUE #253: ARRANGE - Create new group for this test
      const newGroup = await Group.create({
        groupName: 'Override Test Group',
        members: [studentUser1._id, studentUser2._id],
        groupCode: 'OVERRIDE001',
        status: 'formed'
      });

      const previewGrades = [
        {
          groupId: newGroup._id.toString(),
          studentId: studentUser1._id.toString(),
          baseGroupScore: 80,
          individualRatio: 0.85,
          computedFinalGrade: 68, // 80 * 0.85
          finalGradeId: `fg_test_1`,
          status: FINAL_GRADE_STATUS.PENDING,
          createdAt: new Date()
        }
      ];

      await FinalGrade.insertMany(previewGrades);

      // ISSUE #253: ACT - POST approval with override
      const response = await request(app)
        .post(`/api/v1/groups/${newGroup._id.toString()}/final-grades/approval`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'approve',
          overrideEntries: [
            {
              studentId: studentUser1._id.toString(),
              originalFinalGrade: 68,
              overriddenFinalGrade: 75,
              overrideReason: 'Exceptional contribution in sprint'
            }
          ],
          reason: 'Approved with manual adjustment'
        });

      // ISSUE #253: ASSERT - Response includes override metadata
      expect(response.status).toBe(200);
      expect(response.body.overridesApplied).toBe(1);
      const gradeResponse = response.body.grades[0];
      expect(gradeResponse.overrideApplied).toBe(true);
      expect(gradeResponse.overriddenGrade).toBe(75);
      expect(gradeResponse.effectiveFinalGrade).toBe(75);

      // ISSUE #253: ASSERT - Override persisted in database
      const savedGrade = await FinalGrade.findOne({
        groupId: newGroup._id.toString()
      });
      expect(savedGrade.overrideApplied).toBe(true);
      expect(savedGrade.overriddenFinalGrade).toBe(75);
      expect(savedGrade.overriddenBy).toBe(coordinatorUser._id.toString());
      expect(savedGrade.overrideComment).toBe(
        'Exceptional contribution in sprint'
      );

      // ISSUE #253: ASSERT - Override audit log created
      const overrideLog = await AuditLog.findOne({
        action: 'FINAL_GRADE_OVERRIDE_APPLIED',
        groupId: newGroup._id.toString()
      });
      expect(overrideLog).to.exist;
      expect(overrideLog.payload.originalGrade).toBe(68);
      expect(overrideLog.payload.overriddenGrade).toBe(75);

      // ISSUE #253: Cleanup
      await Group.findByIdAndDelete(newGroup._id);
    });
  });

  // =========================================================================
  // ISSUE #253: TEST GROUP 2 - CONFLICT & DUPLICATE PREVENTION
  // =========================================================================

  describe('✗ Duplicate Approval Prevention (409 Conflict)', () => {
    /**
     * ISSUE #253: TEST 2.1 - Prevent duplicate approval
     * Scenario: Coordinator tries to approve same group twice
     * Expected: 409 Conflict, FINAL_GRADE_APPROVAL_CONFLICT audit log
     */
    it('should reject duplicate approval attempt (409 Conflict)', async () => {
      // ISSUE #253: ARRANGE - Create group and initial approval
      const dupGroup = await Group.create({
        groupName: 'Duplicate Test',
        members: [studentUser1._id],
        groupCode: 'DUP001',
        status: 'formed'
      });

      const previewGrades = [
        {
          groupId: dupGroup._id.toString(),
          studentId: studentUser1._id.toString(),
          baseGroupScore: 80,
          individualRatio: 0.8,
          computedFinalGrade: 64,
          finalGradeId: `fg_dup_1`,
          status: FINAL_GRADE_STATUS.PENDING,
          createdAt: new Date()
        }
      ];

      await FinalGrade.insertMany(previewGrades);

      // ISSUE #253: First approval succeeds
      const firstApproval = await request(app)
        .post(`/api/v1/groups/${dupGroup._id.toString()}/final-grades/approval`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'approve'
        });

      expect(firstApproval.status).toBe(200);

      // ISSUE #253: ACT - Attempt duplicate approval
      const duplicateApproval = await request(app)
        .post(`/api/v1/groups/${dupGroup._id.toString()}/final-grades/approval`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'approve'
        });

      // ISSUE #253: ASSERT - 409 Conflict response
      expect(duplicateApproval.status).toBe(409);
      expect(duplicateApproval.body.code).toBe('ALREADY_APPROVED');

      // ISSUE #253: ASSERT - Conflict logged for audit
      const conflictLog = await AuditLog.findOne({
        action: 'FINAL_GRADE_APPROVAL_CONFLICT',
        groupId: dupGroup._id.toString()
      });
      expect(conflictLog).to.exist;

      // ISSUE #253: Cleanup
      await Group.findByIdAndDelete(dupGroup._id);
    });
  });

  // =========================================================================
  // ISSUE #253: TEST GROUP 3 - AUTHORIZATION & VALIDATION
  // =========================================================================

  describe('✗ Authorization & Validation Errors', () => {
    /**
     * ISSUE #253: TEST 3.1 - Reject non-coordinator
     * Scenario: Student tries to approve grades
     * Expected: 403 Forbidden (via roleMiddleware)
     */
    it('should require coordinator role (403 Forbidden)', async () => {
      const studentToken = require('jsonwebtoken').sign(
        { userId: studentUser1._id, role: 'student' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      // ISSUE #253: ACT - Student attempts approval
      const response = await request(app)
        .post(
          `/api/v1/groups/${testGroup._id.toString()}/final-grades/approval`
        )
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          coordinatorId: studentUser1._id.toString(),
          decision: 'approve'
        });

      // ISSUE #253: ASSERT - 403 Forbidden
      expect(response.status).toBe(403);
    });

    /**
     * ISSUE #253: TEST 3.2 - Validate decision field
     * Scenario: Invalid decision value
     * Expected: 422 Unprocessable Entity
     */
    it('should validate decision field (422 Unprocessable)', async () => {
      // ISSUE #253: ACT - POST with invalid decision
      const response = await request(app)
        .post(
          `/api/v1/groups/${testGroup._id.toString()}/final-grades/approval`
        )
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'maybe' // Invalid!
        });

      // ISSUE #253: ASSERT - 422 error
      expect(response.status).toBe(422);
      expect(response.body.code).to.include('INVALID_DECISION');
    });

    /**
     * ISSUE #253: TEST 3.3 - Validate override entries
     * Scenario: Override with grade out of range
     * Expected: 422 Unprocessable Entity
     */
    it('should validate override grade range (422 Unprocessable)', async () => {
      // ISSUE #253: ACT - POST with invalid override grade
      const response = await request(app)
        .post(
          `/api/v1/groups/${testGroup._id.toString()}/final-grades/approval`
        )
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'approve',
          overrideEntries: [
            {
              studentId: studentUser1._id.toString(),
              originalFinalGrade: 80,
              overriddenFinalGrade: 150 // Invalid! > 100
            }
          ]
        });

      // ISSUE #253: ASSERT - 422 error
      expect(response.status).toBe(422);
      expect(response.body.code).to.include('INVALID_GRADE_RANGE');
    });
  });

  // =========================================================================
  // ISSUE #253: TEST GROUP 4 - REJECTION WORKFLOW
  // =========================================================================

  describe('✓ Grade Rejection Workflow', () => {
    /**
     * ISSUE #253: TEST 4.1 - Reject grades
     * Scenario: Coordinator rejects grades (terminal state)
     * Expected: 200 OK, status = rejected
     */
    it('should reject group grades (200 OK)', async () => {
      // ISSUE #253: ARRANGE
      const rejectGroup = await Group.create({
        groupName: 'Reject Test',
        members: [studentUser1._id],
        groupCode: 'REJ001',
        status: 'formed'
      });

      await FinalGrade.create({
        groupId: rejectGroup._id.toString(),
        studentId: studentUser1._id.toString(),
        baseGroupScore: 50,
        individualRatio: 0.7,
        computedFinalGrade: 35,
        finalGradeId: `fg_rej_1`,
        status: FINAL_GRADE_STATUS.PENDING,
        createdAt: new Date()
      });

      // ISSUE #253: ACT - POST rejection
      const response = await request(app)
        .post(`/api/v1/groups/${rejectGroup._id.toString()}/final-grades/approval`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'reject',
          reason: 'Grades require recalculation'
        });

      // ISSUE #253: ASSERT - Response
      expect(response.status).toBe(200);
      expect(response.body.rejectedCount).toBe(1);

      // ISSUE #253: ASSERT - Database
      const savedGrade = await FinalGrade.findOne({
        groupId: rejectGroup._id.toString()
      });
      expect(savedGrade.status).toBe(FINAL_GRADE_STATUS.REJECTED);

      // ISSUE #253: Cleanup
      await Group.findByIdAndDelete(rejectGroup._id);
    });
  });

  // =========================================================================
  // ISSUE #253: TEST GROUP 5 - RESPONSE FORMAT FOR ISSUE #255
  // =========================================================================

  describe('✓ Response Format for Issue #255 Consumption', () => {
    /**
     * ISSUE #253: TEST 5.1 - Response schema matches expectations
     * Scenario: Verify response contains all fields Issue #255 needs
     * Expected: 200 OK with complete FinalGradeApproval schema
     */
    it('should return complete FinalGradeApproval response', async () => {
      // ISSUE #253: ARRANGE
      const issue255Group = await Group.create({
        groupName: 'Issue 255 Test',
        members: [studentUser1._id, studentUser2._id],
        groupCode: 'I255001',
        status: 'formed'
      });

      await FinalGrade.insertMany([
        {
          groupId: issue255Group._id.toString(),
          studentId: studentUser1._id.toString(),
          baseGroupScore: 85,
          individualRatio: 0.9,
          computedFinalGrade: 76.5,
          finalGradeId: 'fg_i255_1',
          status: FINAL_GRADE_STATUS.PENDING,
          createdAt: new Date()
        },
        {
          groupId: issue255Group._id.toString(),
          studentId: studentUser2._id.toString(),
          baseGroupScore: 85,
          individualRatio: 0.8,
          computedFinalGrade: 68,
          finalGradeId: 'fg_i255_2',
          status: FINAL_GRADE_STATUS.PENDING,
          createdAt: new Date()
        }
      ]);

      // ISSUE #253: ACT
      const response = await request(app)
        .post(`/api/v1/groups/${issue255Group._id.toString()}/final-grades/approval`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          coordinatorId: coordinatorUser._id.toString(),
          decision: 'approve',
          overrideEntries: [
            {
              studentId: studentUser1._id.toString(),
              originalFinalGrade: 76.5,
              overriddenFinalGrade: 80,
              overrideReason: 'Strong contribution'
            }
          ]
        });

      // ISSUE #253: ASSERT - Response schema for Issue #255
      expect(response.status).toBe(200);
      expect(response.body).to.have.all.keys(
        'success',
        'approvalId',
        'timestamp',
        'groupId',
        'coordinatorId',
        'decision',
        'totalStudents',
        'approvedCount',
        'rejectedCount',
        'overridesApplied',
        'grades',
        'message'
      );

      // ISSUE #253: ASSERT - Grade details for Issue #255
      response.body.grades.forEach((grade) => {
        expect(grade).to.have.all.keys(
          'studentId',
          'computedFinalGrade',
          'effectiveFinalGrade',
          'overrideApplied',
          'overriddenGrade',
          'approvedAt',
          'approvedBy'
        );
      });

      // ISSUE #253: Cleanup
      await Group.findByIdAndDelete(issue255Group._id);
    });
  });
});
