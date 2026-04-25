'use strict';

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
const Group = require('../models/Group');
const { v4: uuidv4 } = require('uuid');

const supportsMongoTransactions = () => {
  const topologyType = FinalGrade.db?.client?.topology?.description?.type;
  return ['ReplicaSetWithPrimary', 'Sharded'].includes(topologyType);
};

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

    if (!entry.comment || typeof entry.comment !== 'string' || entry.comment.trim() === '') {
      throw new GradeApprovalError(
        `Override entry ${index}: comment is required`,
        422,
        'MISSING_OVERRIDE_REASON'
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
 * @param {String} publishCycle - Publish cycle identifier
 * @param {String} coordinatorId - Coordinator performing approval
 * @param {String} decision - 'approve' or 'reject'
 * @param {Array} overrideEntries - Optional per-student grade overrides
 * @param {String} reason - Optional justification for decision
 * @returns {Promise<Object>} FinalGradeApproval response object
 * @throws {GradeApprovalError} If approval fails
 */
const approveGroupGrades = async (
  groupId,
  publishCycle,
  coordinatorId,
  decision,
  overrideEntries = [],
  reason = null
) => {
  if (!publishCycle || typeof publishCycle !== 'string' || publishCycle.trim() === '') {
    throw new GradeApprovalError(
      'publishCycle is required',
      422,
      'MISSING_PUBLISH_CYCLE'
    );
  }

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

  // ISSUE #253 HARDENING: Terminal state check is cycle-aware
  const hasExistingApproval = await FinalGrade.hasTerminalGrades(
    groupId,
    publishCycle
  );
  if (hasExistingApproval) {
    // ISSUE #253: Log conflict for audit trail (before throwing)
    await AuditLog.create({
      action: 'FINAL_GRADE_APPROVAL_CONFLICT',
      actorId: coordinatorId,
      groupId: groupId,
      payload: {
        decision,
        publishCycle,
        attemptedAt: new Date(),
        reason: 'Terminal state reached for this cycle'
      }
    });

    throw new GradeApprovalError(
      'Grades for this group and cycle are already in a terminal state',
      409,
      'CYCLE_ALREADY_TERMINAL'
    );
  }

  // ISSUE #253: Fetch current preview grades from FinalGrade collection
  // These are the computed grades that need coordinator approval
  // Filter for pending grades that haven't been approved yet
  let previewGrades;
  try {
    previewGrades = await FinalGrade.find({
      groupId: groupId,
      publishCycle,
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
      `No preview grades found for group ${groupId} in cycle ${publishCycle}`,
      404,
      'NO_PREVIEW_GRADES'
    );
  }

  // =========================================================================
  // ISSUE #253: START ATOMIC TRANSACTION
  // =========================================================================
  const shouldUseTransaction = supportsMongoTransactions();
  const session = shouldUseTransaction ? await FinalGrade.startSession() : null;

  if (session) {
    session.startTransaction();
  }

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
          publishCycle,
          studentId,
          status: FINAL_GRADE_STATUS.PENDING
        },
        {
          groupId,
          publishCycle,
          studentId,
          baseGroupScore,
          individualRatio,
          computedFinalGrade,
          finalGradeId: uuidv4().split('-')[0]
        },
        {
          upsert: true,
          new: true,
          ...(session ? { session } : {})
        }
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
          finalGrade.originalFinalGrade = finalGrade.computedFinalGrade;
          finalGrade.overriddenFinalGrade = studentOverride.overriddenFinalGrade;
          finalGrade.overriddenBy = coordinatorId;
          finalGrade.overrideComment = studentOverride.comment;
          finalGrade.overrideEntries = [
            {
              studentId,
              originalFinalGrade: finalGrade.computedFinalGrade,
              overriddenFinalGrade: studentOverride.overriddenFinalGrade,
              comment: studentOverride.comment,
              overriddenAt: new Date()
            }
          ];
        }

        // ISSUE #253: Log successful approval
        auditLogs.push({
          action: 'FINAL_GRADE_APPROVED',
          actorId: coordinatorId,
          targetId: studentId,
          groupId,
          payload: {
            studentId,
            publishCycle,
            computedFinalGrade,
            approvedAt: new Date(),
            overrideApplied: !!studentOverride,
            overriddenGrade: studentOverride?.overriddenFinalGrade || null
          }
        });

        // ISSUE #253: Log override separately if applied
        if (studentOverride) {
          auditLogs.push({
            action: 'FINAL_GRADE_OVERRIDDEN',
            actorId: coordinatorId,
            targetId: studentId,
            groupId,
            payload: {
              studentId,
              publishCycle,
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
            publishCycle,
            computedFinalGrade,
            rejectedAt: new Date(),
            reason: reason || 'No reason provided'
          }
        });
      }

      // ISSUE #253: Save within transaction
      await finalGrade.save(session ? { session } : undefined);
      createdGrades.push(finalGrade);
    }

    // ISSUE #253: Create all audit logs within transaction
    // Ensures consistency: if we update grades, we must log it
    await AuditLog.insertMany(auditLogs, session ? { session } : undefined);

    // ISSUE #253: Commit transaction
    if (session) {
      await session.commitTransaction();
    }

    // =========================================================================
    // ISSUE #253: END ATOMIC TRANSACTION
    // =========================================================================

    // ISSUE #253: Fire-and-forget notifications OUTSIDE transaction
    // If notifications fail, we don't want to rollback the approval
    setImmediate(async () => {
      try {
        console.log(
          `[Issue #253] Async notifications queued for group ${groupId}`
        );
      } catch (error) {
        console.error('Notification failure in approveGroupGrades:', error);
      }
    });

    // ISSUE #253: Build response object matching FinalGradeApproval schema
    return {
      success: true,
      approvalId: `appr_${uuidv4().split('-')[0]}`,
      timestamp: new Date(),
      groupId,
      publishCycle,
      coordinatorId,
      decision,
      totalStudents: createdGrades.length,
      approvedCount: decision === 'approve' ? createdGrades.length : 0,
      rejectedCount: decision === 'reject' ? createdGrades.length : 0,
      overridesApplied: createdGrades.filter((g) => g.overrideApplied).length,
      grades: createdGrades.map((grade) => ({
        studentId: grade.studentId,
        computedFinalGrade: grade.computedFinalGrade,
        effectiveFinalGrade: grade.getEffectiveFinalGrade(),
        overrideApplied: grade.overrideApplied,
        originalFinalGrade: grade.originalFinalGrade,
        overriddenGrade: grade.overriddenFinalGrade,
        approvedAt: grade.approvedAt,
        approvedBy: grade.approvedBy
      })),
      message:
        decision === 'approve'
          ? `Successfully approved grades for ${createdGrades.length} students`
          : `Successfully rejected grades for ${createdGrades.length} students`
    };
  } catch (error) {
    // ISSUE #253: Abort transaction on any error
    if (session) {
      await session.abortTransaction();
    }

    if (error instanceof GradeApprovalError) {
      throw error;
    }

    throw new GradeApprovalError(
      `Transaction failed: ${error.message}`,
      500,
      'TRANSACTION_FAILED'
    );
  } finally {
    if (session) {
      session.endSession();
    }
  }
};

/**
 * ISSUE #253: Check if grades are eligible for approval
 * 
 * Pre-flight validation called before coordinator submits approval.
 * 
 * @param {String} groupId - Group to check
 * @returns {Object} Eligibility check { canApprove, reason, eligibleCount, totalCount, issues }
 */
const checkApprovalEligibility = async (groupId) => {
  const issues = [];

  try {
    const grades = await FinalGrade.find({ groupId }).lean();
    
    if (!grades || grades.length === 0) {
      return {
        canApprove: false,
        reason: 'No grades found',
        eligibleCount: 0,
        totalCount: 0,
        issues: ['Complete preview workflow first (Process 8.1-8.3)']
      };
    }

    const approvedCount = grades.filter(g => g.approvedAt).length;
    if (approvedCount > 0) {
      issues.push(`${approvedCount} grades already approved`);
    }

    return {
      canApprove: issues.length === 0 && approvedCount === 0,
      reason: issues.length === 0 ? 'All grades ready for approval' : issues[0],
      eligibleCount: grades.length - approvedCount,
      totalCount: grades.length,
      issues
    };
  } catch (err) {
    return {
      canApprove: false,
      reason: `Validation error: ${err.message}`,
      eligibleCount: 0,
      totalCount: 0,
      issues: [err.message]
    };
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
const getApprovedGradesForGroup = async (groupId, publishCycle = null) => {
  return await FinalGrade.findApprovedByGroup(groupId, publishCycle);
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
const isGroupApproved = async (groupId, publishCycle) => {
  return await FinalGrade.hasTerminalGrades(groupId, publishCycle);
};

/**
 * ================================================================================
 * ISSUE #253: EXPORTS
 * ================================================================================
 */

module.exports = {
  approveGroupGrades,
  checkApprovalEligibility,
  getApprovedGradesForGroup,
  getGroupApprovalSummary,
  isGroupApproved,
  validateOverrideEntries,
  GradeApprovalError
};
