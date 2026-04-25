'use strict';

/**
 * ================================================================================
 * GRADE APPROVAL SERVICE
 * ================================================================================
 * 
 * ISSUE #253: Final Grade Approval Workflow
 * 
 * This service handles the approval process (Process 8.4) where coordinator
 * reviews computed final grades and decides to approve or reject.
 */

const FinalGrade = require('../models/FinalGrade');
const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');

/**
 * ISSUE #253: Custom error for approval operations
 */
class GradeApprovalError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'GradeApprovalError';
    this.statusCode = statusCode;
  }
}

/**
 * ISSUE #253: Helper function to process grade updates
 * Extracted to reduce cognitive complexity
 */
const _updateGradeWithApproval = async (
  grade,
  decision,
  coordinatorId,
  reason,
  publishCycle,
  override,
  session
) => {
  const approvalTimestamp = new Date();
  const isRejected = decision === 'reject';

  const updateData = {
    status: isRejected ? 'rejected' : 'approved',
    approvedAt: approvalTimestamp,
    approvedBy: coordinatorId,
    approvalComment: reason,
    publishCycle
  };

  if (override) {
    // ISSUE #253: Apply override with full audit trail
    updateData.override = true;
    updateData.overrideValue = override.value;
    updateData.overrideAppliedBy = coordinatorId;
    updateData.overrideReason = override.reason;
    updateData.originalComputedScore = grade.finalScore;
    updateData.finalScore = override.value;

    // Log override separately for audit trail
    await createAuditLog({
      action: 'FINAL_GRADE_OVERRIDE_APPLIED',
      userId: coordinatorId,
      resourceType: 'FinalGrade',
      resourceId: grade._id,
      details: {
        studentId: grade.studentId,
        originalScore: grade.finalScore,
        overrideValue: override.value,
        reason: override.reason
      }
    }, { session });
  }

  return FinalGrade.findByIdAndUpdate(
    grade._id,
    updateData,
    { session, new: true }
  );
};

/**
 * ISSUE #253: Approve/reject group grades after coordinator review
 */
const approveGroupGrades = async (groupId, approvalData) => {
  // ISSUE #253: Validate basic inputs
  if (!groupId || typeof groupId !== 'string') {
    throw new GradeApprovalError('Invalid groupId', 400);
  }

  const {
    decision,
    publishCycle,
    reason,
    coordinatorId,
    overrideEntries = []
  } = approvalData;

  if (!decision || !['approve', 'reject', 'partial'].includes(decision)) {
    throw new GradeApprovalError('Decision must be approve/reject/partial', 400);
  }

  if (!coordinatorId || typeof coordinatorId !== 'string') {
    throw new GradeApprovalError('coordinatorId required', 400);
  }

  // ISSUE #253: Validate group exists
  const group = await Group.findById(groupId);
  if (!group) {
    throw new GradeApprovalError('Group not found', 404);
  }

  // ISSUE #253: Fetch all grades for this group
  const grades = await FinalGrade.find({ groupId });
  if (!grades || grades.length === 0) {
    throw new GradeApprovalError(
      'No grades found for group',
      422
    );
  }

  // ISSUE #253: Check for duplicate approval (idempotency guard)
  const alreadyApproved = grades.some(g => g.approvedAt);
  if (alreadyApproved && decision === 'approve') {
    throw new GradeApprovalError(
      'Grades already approved (idempotency conflict)',
      409
    );
  }

  // ISSUE #253: Update all grades with approval decision
  try {
    const approvalTimestamp = new Date();
    
    for (const grade of grades) {
      const studentIdStr = grade.studentId?.toString();
      const override = overrideEntries.find(
        o => o.studentId === studentIdStr
      );

      await _updateGradeWithApproval(
        grade,
        decision,
        coordinatorId,
        reason,
        publishCycle,
        override,
        null
      );
    }

    // ISSUE #253: Log approval decision
    await createAuditLog({
      action: decision === 'reject' ? 'FINAL_GRADE_REJECTED' : 'FINAL_GRADE_APPROVED',
      userId: coordinatorId,
      resourceType: 'Group',
      resourceId: groupId,
      details: {
        gradeCount: grades.length,
        decision,
        publishCycle,
        reason,
        overrideCount: overrideEntries.length,
        timestamp: approvalTimestamp
      }
    });

    return {
      success: true,
      groupId,
      groupName: group.name,
      gradeCount: grades.length,
      overrideCount: overrideEntries.length,
      decision,
      approvedAt: approvalTimestamp,
      message: `${decision === 'reject' ? 'Rejected' : 'Approved'} ${grades.length} grades`
    };

  } catch (err) {
    if (err?.message?.includes?.('conflict')) {
      throw new GradeApprovalError(
        'Approval conflict detected',
        409
      );
    }
    throw new GradeApprovalError(
      `Approval failed: ${err?.message}`,
      500
    );
  }
};

/**
 * ISSUE #253: Check if grades are eligible for approval
 * 
 * Pre-flight validation called before coordinator submits approval.
 * Returns what grades can be approved vs which have issues.
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

    // Check if any already approved
    const approvedCount = grades.filter(g => g.approvedAt).length;
    if (approvedCount > 0) {
      issues.push(`${approvedCount} grades already approved`);
    }

    // Check each grade has finalScore
    const incompleteCount = grades.filter(
      g => g.finalScore === undefined || g.finalScore === null
    ).length;

    if (incompleteCount > 0) {
      issues.push(`${incompleteCount} grades missing finalScore`);
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
 * Module exports
 * 
 * Used by finalGradeController.js for Process 8.4 approval endpoint (Issue #253)
 * and imported by publishService.js for state validation before publication (Issue #255).
 */
module.exports = {
  approveGroupGrades,
  checkApprovalEligibility,
  GradeApprovalError
};
