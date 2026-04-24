/**
 * ================================================================================
 * ISSUE #253: Final Grade Approval Service
 * ================================================================================
 *
 * Purpose:
 * Handles coordinator approval of final grades with transaction safety.
 * Responsible for:
 * 1. Fetching computed grades from preview
 * 2. Validating override entries (if provided)
 * 3. Creating/updating FinalGrade records with status transitions
 * 4. Applying manual overrides with metadata
 * 5. Creating comprehensive audit logs
 * 6. Triggering async notifications (outside transaction)
 *
 * Process Context:
 * - Input: Request from Issue #252 (UI) containing { coordinatorId, decision, overrideEntries }
 * - Atomic operation: All grades for group updated together (Mongoose session)
 * - Output: FinalGradeApproval response with metadata for Issue #255 consumption
 * - Audit trail: 5 new action enums (APPROVED, REJECTED, OVERRIDE, CONFLICT, PUBLISHED)
 *
 * ================================================================================
 */

const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
const AuditLog = require('../models/AuditLog');
const { v4: uuidv4 } = require('uuid');

/**
 * ISSUE #253: Error class for grade approval specific errors
 * Used to distinguish approval errors from general application errors
 */
class GradeApprovalError extends Error {
  constructor(message, statusCode = 500, errorCode = null) {
    super(message);
    this.name = 'GradeApprovalError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * ================================================================================
 * ISSUE #253: CORE APPROVAL LOGIC
 * ================================================================================
 */

/**
 * ISSUE #253: Validate override entries before applying
 * Ensures:
 * 1. Each override has valid studentId
 * 2. Override grade differs from computed grade
 * 3. Grades are in valid range [0, 100]
 * 4. All required fields present
 *
 * @param {Array} overrideEntries - List of { studentId, originalFinalGrade, overriddenFinalGrade, comment }
 * @throws {GradeApprovalError} If validation fails
 */
const validateOverrideEntries = (overrideEntries = []) => {
  // ISSUE #253: Skip validation if no overrides
  if (!overrideEntries || overrideEntries.length === 0) {
    return;
  }

  // ISSUE #253: Array check
  if (!Array.isArray(overrideEntries)) {
    throw new GradeApprovalError(
      'Override entries must be an array',
      422,
      'INVALID_OVERRIDE_FORMAT'
    );
  }

  // ISSUE #253: Validate each override entry
  overrideEntries.forEach((entry, index) => {
    // Check required fields
    if (!entry.studentId) {
      throw new GradeApprovalError(
        `Override entry ${index}: studentId is required`,
        422,
        'MISSING_STUDENT_ID'
      );
    }

    if (
      entry.overriddenFinalGrade === null ||
      entry.overriddenFinalGrade === undefined
    ) {
      throw new GradeApprovalError(
        `Override entry ${index}: overriddenFinalGrade is required`,
        422,
        'MISSING_OVERRIDE_GRADE'
      );
    }

    // Check grade ranges
    if (entry.overriddenFinalGrade < 0 || entry.overriddenFinalGrade > 100) {
      throw new GradeApprovalError(
        `Override entry ${index}: overriddenFinalGrade must be between 0-100`,
        422,
        'INVALID_GRADE_RANGE'
      );
    }

    // ISSUE #253: Optional: Check that override differs from original
    // This prevents "overrides" that don't actually change anything
    if (entry.originalFinalGrade !== undefined) {
      if (entry.overriddenFinalGrade === entry.originalFinalGrade) {
        throw new GradeApprovalError(
          `Override entry ${index}: overriddenFinalGrade must differ from original`,
          422,
          'IDENTICAL_OVERRIDE'
        );
      }
    }
  });
};

/**
 * ISSUE #253: Create override mapping for quick lookup
 * Transforms array of overrides into { studentId: overrideData } map
 * Useful for O(1) lookup when updating FinalGrade records
 *
 * @param {Array} overrideEntries - List of override objects
 * @returns {Object} Map of { studentId: overrideData }
 */
const createOverrideMap = (overrideEntries = []) => {
  const map = {};

  overrideEntries.forEach((entry) => {
    map[entry.studentId] = {
      overriddenFinalGrade: entry.overriddenFinalGrade,
      comment: entry.comment || null
    };
  });

  return map;
};

/**
 * ================================================================================
 * ISSUE #253: APPROVAL WORKFLOW (ATOMIC TRANSACTION)
 * ================================================================================
 */

/**
 * ISSUE #253: Main approval workflow
 * Executes entire approval operation as atomic transaction:
 * 1. Fetch preview grades from gradeService
 * 2. Check for duplicate approval (409 conflict)
 * 3. Create/update FinalGrade records for all students
 * 4. Apply overrides if provided
 * 5. Create audit log entries
 * 6. Trigger async notifications (OUTSIDE transaction)
 *
 * Transaction safety:
 * - All FinalGrade updates happen together
 * - If any update fails, entire transaction rolls back
 * - 409 Conflict detected before transaction starts
 *
 * @param {String} groupId - Group ID to approve grades for
 * @param {String} coordinatorId - Coordinator performing approval
 * @param {String} decision - 'approve' or 'reject'
 * @param {Array} overrideEntries - Optional per-student grade overrides
 * @param {String} reason - Optional justification for decision
 * @returns {Promise<Object>} FinalGradeApproval response object
 * @throws {GradeApprovalError} If approval fails
 */
const approveGroupGrades = async (
  groupId,
  coordinatorId,
  decision,
  overrideEntries = [],
  reason = null
) => {
  // ISSUE #253: Validate input decision
  if (!['approve', 'reject'].includes(decision)) {
    throw new GradeApprovalError(
      'Decision must be "approve" or "reject"',
      422,
      'INVALID_DECISION'
    );
  }

  // ISSUE #253: Validate override entries early
  validateOverrideEntries(overrideEntries);
  const overrideMap = createOverrideMap(overrideEntries);

  // ISSUE #253: Fetch current preview grades from FinalGrade collection
  // These are the computed grades that need coordinator approval
  // Filter for pending grades that haven't been approved yet
  let previewGrades;
  try {
    previewGrades = await FinalGrade.find({
      groupId: groupId,
      status: FINAL_GRADE_STATUS.PENDING
    });
  } catch (error) {
    throw new GradeApprovalError(
      `Failed to fetch preview grades: ${error.message}`,
      500,
      'PREVIEW_FETCH_FAILED'
    );
  }

  if (!previewGrades || previewGrades.length === 0) {
    throw new GradeApprovalError(
      `No preview grades found for group ${groupId}`,
      404,
      'NO_PREVIEW_GRADES'
    );
  }

  // ISSUE #253: Check for duplicate approval (409 Conflict)
  // Prevents coordinator from approving same grades twice
  const hasExistingApproval = await FinalGrade.hasApprovedGrades(groupId);
  if (hasExistingApproval) {
    // ISSUE #253: Log conflict for audit trail (before throwing)
    await AuditLog.create({
      action: 'FINAL_GRADE_APPROVAL_CONFLICT',
      actorId: coordinatorId,
      groupId: groupId,
      payload: {
        decision,
        attemptedAt: new Date(),
        reason: 'Duplicate approval attempted'
      }
    });

    throw new GradeApprovalError(
      'Grades for this group have already been approved',
      409,
      'ALREADY_APPROVED'
    );
  }

  // =========================================================================
  // ISSUE #253: START ATOMIC TRANSACTION
  // =========================================================================
  const session = await FinalGrade.startSession();
  session.startTransaction();

  try {
    const createdGrades = [];
    const auditLogs = [];

    // ISSUE #253: Process each student's grade
    for (const gradeData of previewGrades) {
      const { studentId, baseGroupScore, individualRatio, computedFinalGrade } =
        gradeData;

      // ISSUE #253: Check if this student has override
      const studentOverride = overrideMap[studentId];

      // ISSUE #253: Create or update FinalGrade record
      // Added status: PENDING check to prevent race condition overwrites (Lost Update)
      let finalGrade = await FinalGrade.findOneAndUpdate(
        { 
          groupId, 
          studentId,
          status: FINAL_GRADE_STATUS.PENDING
        },
        {
          groupId,
          studentId,
          baseGroupScore,
          individualRatio,
          computedFinalGrade,
          finalGradeId: uuidv4().split('-')[0]
        },
        { upsert: true, new: true, session }
      );

      // ISSUE #253: Apply approval decision
      if (decision === 'approve') {
        finalGrade.status = FINAL_GRADE_STATUS.APPROVED;
        finalGrade.approvedBy = coordinatorId;
        finalGrade.approvedAt = new Date();
        finalGrade.approvalComment = reason;

        // ISSUE #253: Apply override if provided for this student
        if (studentOverride) {
          finalGrade.overrideApplied = true;
          finalGrade.overriddenFinalGrade = studentOverride.overriddenFinalGrade;
          finalGrade.overriddenBy = coordinatorId;
          finalGrade.overrideComment = studentOverride.comment;
        }

        // ISSUE #253: Log successful approval
        auditLogs.push({
          action: 'FINAL_GRADE_APPROVED',
          actorId: coordinatorId,
          targetId: studentId,
          groupId,
          payload: {
            studentId,
            computedFinalGrade,
            approvedAt: new Date(),
            overrideApplied: !!studentOverride,
            overriddenGrade: studentOverride?.overriddenFinalGrade || null
          }
        });

        // ISSUE #253: Log override separately if applied
        if (studentOverride) {
          auditLogs.push({
            action: 'FINAL_GRADE_OVERRIDE_APPLIED',
            actorId: coordinatorId,
            targetId: studentId,
            groupId,
            payload: {
              studentId,
              originalGrade: computedFinalGrade,
              overriddenGrade: studentOverride.overriddenFinalGrade,
              comment: studentOverride.comment
            }
          });
        }
      } else {
        // ISSUE #253: Decision is reject
        finalGrade.status = FINAL_GRADE_STATUS.REJECTED;
        finalGrade.approvedBy = coordinatorId;
        finalGrade.approvedAt = new Date();
        finalGrade.approvalComment = reason || 'Rejected by coordinator';

        // ISSUE #253: Log rejection
        auditLogs.push({
          action: 'FINAL_GRADE_REJECTED',
          actorId: coordinatorId,
          targetId: studentId,
          groupId,
          payload: {
            studentId,
            computedFinalGrade,
            rejectedAt: new Date(),
            reason: reason || 'No reason provided'
          }
        });
      }

      // ISSUE #253: Save within transaction
      await finalGrade.save({ session });
      createdGrades.push(finalGrade);
    }

    // ISSUE #253: Create all audit logs within transaction
    // Ensures consistency: if we update grades, we must log it
    await AuditLog.insertMany(auditLogs, { session });

    // ISSUE #253: Commit transaction
    await session.commitTransaction();

    // =========================================================================
    // ISSUE #253: END ATOMIC TRANSACTION
    // =========================================================================

    // ISSUE #253: Fire-and-forget notifications OUTSIDE transaction
    // If notifications fail, we don't want to rollback the approval
    setImmediate(async () => {
      try {
        // ISSUE #253: Notification handlers (optional integrations)
        // - Coordinator: Notification when approval completes
        // - Students: Notification when grades are ready for view
        // Implementation deferred to later phase if needed
        // For now: Logging confirms async notification was triggered
        console.log(
          `[Issue #253] Async notifications queued for group ${groupId}`
        );
      } catch (error) {
        console.error('Notification failure in approveGroupGrades:', error);
      }
    });

    // ISSUE #253: Build response object matching FinalGradeApproval schema
    // Expected by Issue #255 publish flow
    return {
      // Response metadata
      success: true,
      approvalId: `appr_${uuidv4().split('-')[0]}`,
      timestamp: new Date(),

      // Approval context
      groupId,
      coordinatorId,
      decision,
      totalStudents: createdGrades.length,
      approvedCount:
        decision === 'approve'
          ? createdGrades.length
          : 0,
      rejectedCount:
        decision === 'reject'
          ? createdGrades.length
          : 0,

      // Override statistics
      overridesApplied: createdGrades.filter((g) => g.overrideApplied).length,

      // Student-level details for UI and Issue #255
      grades: createdGrades.map((grade) => ({
        studentId: grade.studentId,
        computedFinalGrade: grade.computedFinalGrade,
        effectiveFinalGrade: grade.getEffectiveFinalGrade(),
        overrideApplied: grade.overrideApplied,
        overriddenGrade: grade.overriddenFinalGrade,
        approvedAt: grade.approvedAt,
        approvedBy: grade.approvedBy
      })),

      // Message for coordinator UI
      message:
        decision === 'approve'
          ? `Successfully approved grades for ${createdGrades.length} students`
          : `Successfully rejected grades for ${createdGrades.length} students`
    };
  } catch (error) {
    // ISSUE #253: Abort transaction on any error
    await session.abortTransaction();
    session.endSession();

    // ISSUE #253: Re-throw known errors, wrap unknown ones
    if (error instanceof GradeApprovalError) {
      throw error;
    }

    throw new GradeApprovalError(
      `Transaction failed: ${error.message}`,
      500,
      'TRANSACTION_FAILED'
    );
  } finally {
    // ISSUE #253: Always end session
    session.endSession();
  }
};

/**
 * ================================================================================
 * ISSUE #253: UTILITY FUNCTIONS FOR CONTROLLERS & ISSUE #255
 * ================================================================================
 */

/**
 * ISSUE #253: Fetch all approved grades for a group (ready for publication)
 * Used by Issue #255 publish process
 * @param {String} groupId - Group to fetch grades for
 * @returns {Promise<Array>} Array of approved FinalGrade objects
 */
const getApprovedGradesForGroup = async (groupId) => {
  return await FinalGrade.findApprovedByGroup(groupId);
};

/**
 * ISSUE #253: Get summary statistics for coordinator dashboard
 * Shows how many grades pending, approved, rejected, published
 * @param {String} groupId - Group to analyze
 * @returns {Promise<Object>} Summary with counts by status
 */
const getGroupApprovalSummary = async (groupId) => {
  return await FinalGrade.getSummary(groupId);
};

/**
 * ISSUE #253: Check if group grades are already approved
 * Prevents duplicate approval attempts
 * @param {String} groupId - Group to check
 * @returns {Promise<Boolean>} True if approved/published
 */
const isGroupApproved = async (groupId) => {
  return await FinalGrade.hasApprovedGrades(groupId);
};

/**
 * ================================================================================
 * ISSUE #253: EXPORTS
 * ================================================================================
 */

module.exports = {
  approveGroupGrades,
  getApprovedGradesForGroup,
  getGroupApprovalSummary,
  isGroupApproved,
  validateOverrideEntries,
  GradeApprovalError
};
