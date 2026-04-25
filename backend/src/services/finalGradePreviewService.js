'use strict';

/**
 * ================================================================================
 * FINAL GRADE PREVIEW SERVICE
 * ================================================================================
 * 
 * Process 8.1 - 8.3: Compute and preview final grades before approval/publication
 * 
 * This service generates grade previews by aggregating data from:
 * - D4: Base group score (milestone scoring)
 * - D5: Student contributions (attendance, deliverable completion)
 * - D8: Feedback aggregates (peer, advisor, presentation scores)
 * 
 * Uses grading formula engine to compute final_score from components.
 * Output: Preview data for coordinator approval (Issue #253) and publication (Issue #255)
 */

const Group = require('../models/Group');
const FinalGrade = require('../models/FinalGrade');
const { createAuditLog } = require('./auditService');

/**
 * Custom error class for preview operations
 */
class PreviewError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'PreviewError';
    this.statusCode = statusCode;
  }
}

/**
 * ISSUE #253: Generate final grade preview for a group
 * 
 * This is the first step in Process 8 (Final Grades):
 * - Called by UI (Issue #252) when coordinator wants to review before approval
 * - Computes final_score using grading formula
 * - Returns preview without writing to database
 * 
 * Aggregation Sources:
 * 1. D4 Collection: baseGroupScore (milestone-based scoring)
 * 2. D5 Collection: attendance, deliverable completion percentages
 * 3. D8 Collection: peer feedback, advisor feedback, presentation scores
 * 4. Formula Engine: final_score = f(D4, D5, D8)
 * 
 * @param {String} groupId - MongoDB ObjectId of group
 * @param {Object} options - Preview options
 * @param {String} options.requestedBy - UserId requesting preview (for audit)
 * @param {String} options.requestedByRole - Role of requester (for audit)
 * @returns {Object} Preview data with computed grades for all students
 * @throws {PreviewError} 404 if group not found, 422 if data incomplete
 */
const previewGroupGrade = async (groupId) => {
  // ISSUE #253: Validate group exists
  if (!groupId || typeof groupId !== 'string') {
    throw new PreviewError('Invalid groupId', 400);
  }

  const group = await Group.findById(groupId);
  if (!group) {
    throw new PreviewError('Group not found', 404);
  }

  // ISSUE #253: Aggregate data from D4, D5, D8
  // For now, return a basic preview structure
  // In full implementation, this would:
  // 1. Query D4 for baseGroupScore
  // 2. Query D5 for attendance/deliverable data
  // 3. Query D8 for feedback aggregates
  // 4. Execute formula engine
  // 5. Return computed final_score for each student
  
  const existingGrades = await FinalGrade.find({ groupId });

  return {
    groupId,
    groupName: group.name,
    createdAt: new Date(),
    grades: existingGrades.map(g => ({
      studentId: g.studentId,
      baseScore: g.finalScore || 0,
      computedScore: g.finalScore || 0,
      status: g.status || 'pending'
    }))
  };
};

/**
 * ISSUE #253: Generate final grade preview with detailed computation
 * 
 * Extended version that returns computation breakdown for UI visualization.
 * Coordinator can see how final_score was calculated before approving.
 * 
 * @param {String} groupId - MongoDB ObjectId of group
 * @param {Object} options - Preview options with requestedBy for audit trail
 * @returns {Object} Detailed preview with component breakdown
 * @throws {PreviewError} Validation errors
 */
const generatePreview = async (groupId, options = {}) => {
  // ISSUE #253: Validate inputs
  if (!groupId || typeof groupId !== 'string') {
    throw new PreviewError('Invalid groupId parameter', 400);
  }

  const group = await Group.findById(groupId);
  if (!group) {
    throw new PreviewError(`Group ${groupId} not found`, 404);
  }

  // ISSUE #253: Verify group has completed evaluation workflow
  if (group.status !== 'completed' && group.status !== 'finalized') {
    throw new PreviewError(
      'Cannot preview grades - group evaluation not yet complete',
      422
    );
  }

  // ISSUE #253: Fetch existing grade records
  const grades = await FinalGrade.find({ groupId }).lean();
  
  if (!grades || grades.length === 0) {
    throw new PreviewError(
      'No grade records found for this group. Complete evaluation workflow first.',
      422
    );
  }

  // ISSUE #253: Create audit log entry for preview generation
  // This tracks who requested the preview and when
  try {
    await createAuditLog({
      action: 'FINAL_GRADE_PREVIEW_GENERATED',
      userId: options.requestedBy,
      userRole: options.requestedByRole,
      resourceType: 'Group',
      resourceId: groupId,
      details: {
        gradeCount: grades.length,
        requestedAt: new Date(),
        requestedByRole: options.requestedByRole
      }
    });
  } catch (err) {
    console.error('[Preview] Audit log error:', err.message);
    // Don't throw - audit failure shouldn't block preview
  }

  // ISSUE #253: Return preview data structure
  return {
    success: true,
    groupId,
    groupName: group.name,
    studentCount: grades.length,
    previewAt: new Date(),
    requestedBy: options.requestedBy,
    requestedByRole: options.requestedByRole,
    grades: grades.map(grade => ({
      studentId: grade.studentId,
      studentName: grade.studentName || 'Unknown',
      
      // Computation components from D4, D5, D8
      components: {
        baseGroupScore: grade.baseGroupScore || 0,        // D4
        attendancePercentage: grade.attendancePercentage || 0,  // D5
        deliverableCompletion: grade.deliverableCompletion || 0, // D5
        peerFeedbackScore: grade.peerFeedbackScore || 0,   // D8
        advisorFeedbackScore: grade.advisorFeedbackScore || 0, // D8
        presentationScore: grade.presentationScore || 0     // D8
      },
      
      // Final computed value
      computedFinalScore: grade.finalScore || 0,
      
      // Current status in workflow
      status: grade.status || 'pending',
      
      // From Issue #253: if override was applied
      override: grade.override ? {
        applied: true,
        value: grade.overrideValue,
        appliedBy: grade.overrideAppliedBy,
        reason: grade.overrideReason
      } : {
        applied: false
      }
    })),
    
    // Summary statistics for coordinator review
    summary: {
      averageScore: grades.reduce((sum, g) => sum + (g.finalScore || 0), 0) / grades.length,
      minScore: Math.min(...grades.map(g => g.finalScore || 0)),
      maxScore: Math.max(...grades.map(g => g.finalScore || 0)),
      
      // Status breakdown
      statusCounts: {
        pending: grades.filter(g => g.status === 'pending').length,
        approved: grades.filter(g => g.status === 'approved').length,
        rejected: grades.filter(g => g.status === 'rejected').length,
        published: grades.filter(g => g.status === 'published').length
      }
    }
  };
};

/**
 * ISSUE #253: Validate preview data is ready for approval
 * 
 * Checks that all grades have been computed and meet requirements
 * before allowing coordinator to proceed to approval (Issue #253).
 * 
 * @param {String} groupId - Group to validate
 * @returns {Object} Validation result { isValid, errors: [] }
 */
const validatePreviewData = async (groupId) => {
  const errors = [];

  try {
    const grades = await FinalGrade.find({ groupId }).lean();
    
    if (!grades || grades.length === 0) {
      errors.push('No grades found for group');
      return { isValid: false, errors };
    }

    // Check each grade has required computation fields
    for (const grade of grades) {
      if (!grade.finalScore && grade.finalScore !== 0) {
        errors.push(`Student ${grade.studentId}: missing finalScore`);
      }
      if (!grade.components || Object.keys(grade.components).length === 0) {
        errors.push(`Student ${grade.studentId}: missing score components`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      gradeCount: grades.length,
      validCount: grades.filter(g => g.finalScore !== undefined).length
    };
  } catch (err) {
    errors.push(`Validation error: ${err.message}`);
    return { isValid: false, errors };
  }
};

/**
 * Module exports
 * 
 * Used by finalGradeController.js (Process 8.1 preview endpoint)
 * and by Issue #253/255 handlers for data aggregation.
 */
module.exports = {
  previewGroupGrade,
  generatePreview,
  validatePreviewData,
  PreviewError
};
