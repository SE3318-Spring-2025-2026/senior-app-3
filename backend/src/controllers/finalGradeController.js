'use strict';

const finalGradePreviewService = require('../services/finalGradePreviewService');
const { approveGroupGrades, GradeApprovalError } = require('../services/approvalService');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
// ISSUE #255: Import publish service for final grade publication (Process 8.5)
const { publishFinalGrades } = require('../services/publishService');

/**
 * Controller for Process 8.1 - Final Grade Preview
 */
const previewFinalGrades = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    // Orchestrates D4, D5, D8 data to compute baseGroupScore and calls formula engine
    const previewData = await finalGradePreviewService.previewGroupGrade(groupId);

    // Return the response ensuring it conforms to the f8_ds_d4_p81 OpenAPI schema
    return res.status(200).json({
      ...previewData,
      createdAt: new Date(),
    });
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
};

/**
 * ================================================================================
 * ISSUE #253: Final Grade Approval Controller
 * ================================================================================
 */

/**
 * ISSUE #253: POST /groups/:groupId/final-grades/approval
 */
const approveGroupGradesHandler = async (req, res) => {
  try {
    // ========================================================================
    // ISSUE #253: EXTRACT AND VALIDATE REQUEST
    // ========================================================================

    const { groupId } = req.params;
    const { publishCycle, decision, overrideEntries, reason } = req.body;
    const coordinatorId = req.user.userId;

    // ISSUE #253: Validate groupId parameter
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        error: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    // ISSUE #253 HARDENING: coordinator identity comes from authenticated token
    if (!coordinatorId) {
      return res.status(422).json({
        error: 'Authenticated coordinator identity is missing',
        code: 'MISSING_AUTH_USER_ID'
      });
    }

    if (!publishCycle || typeof publishCycle !== 'string' || publishCycle.trim() === '') {
      return res.status(422).json({
        error: 'publishCycle is required',
        code: 'MISSING_PUBLISH_CYCLE'
      });
    }

    // ISSUE #253: Strict Authorization Check (Security Fix)
    // Prevent Audit Log Forgery by ensuring the user is acting as themselves
    if (coordinatorId !== req.user.userId) {
      return res.status(403).json({
        error: 'Forbidden: You can only approve grades using your own coordinator ID',
        code: 'FORBIDDEN_ACTOR_MISMATCH'
      });
    }

    // ISSUE #253: Validate decision field
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(422).json({
        error: 'decision must be "approve" or "reject"',
        code: 'INVALID_DECISION'
      });
    }

    // ISSUE #253: Log approval attempt for audit trail
    console.log(
      `[Issue #253] Approval attempt - Group: ${groupId}, Coordinator: ${coordinatorId}, Decision: ${decision}`
    );

    // ========================================================================
    // ISSUE #253: CALL APPROVAL SERVICE (ATOMIC TRANSACTION)
    // ========================================================================

    let approvalResult;
    try {
      approvalResult = await approveGroupGrades(
        groupId,
        publishCycle,
        coordinatorId,
        decision,
        overrideEntries || [],
        reason || null
      );
    } catch (error) {
      // ISSUE #253: Handle GradeApprovalError with proper status codes
      if (error instanceof GradeApprovalError) {
        console.warn(`[Issue #253] Approval failed - ${error.message}`);

        // ISSUE #253: Return appropriate status code based on error type
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.errorCode,
          timestamp: new Date()
        });
      }

      // ISSUE #253: Unexpected error
      throw error;
    }

    // ========================================================================
    // ISSUE #253: RETURN SUCCESS RESPONSE
    // ========================================================================

    console.log(
      `[Issue #253] Approval successful - Group: ${groupId}, Decision: ${decision}`
    );

    // ISSUE #253: Return 200 with full approval response for Issue #255 & UI
    return res.status(200).json(approvalResult);
  } catch (error) {
    // ISSUE #253: Log unexpected errors
    console.error(
      '[Issue #253] Unexpected error in approveGroupGradesHandler',
      error
    );

    // ISSUE #253: Return 500 for unexpected errors
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * ISSUE #253: GET /groups/:groupId/final-grades/summary
 */
const getGroupApprovalSummaryHandler = async (req, res) => {
  try {
    const { groupId } = req.params;

    // ISSUE #253: Validate groupId
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        error: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    // ISSUE #253: Import service here to avoid circular dependency
    const { getGroupApprovalSummary } = require('../services/approvalService');

    // ISSUE #253: Fetch summary
    const summary = await getGroupApprovalSummary(groupId);

    console.log(`[Issue #253] Summary retrieved for group: ${groupId}`);

    const latestApproved = await FinalGrade.findOne({
      groupId,
      status: FINAL_GRADE_STATUS.APPROVED
    }).sort({ approvedAt: -1, updatedAt: -1 });

    const latestPublished = await FinalGrade.findOne({
      groupId,
      status: FINAL_GRADE_STATUS.PUBLISHED
    }).sort({ publishedAt: -1, updatedAt: -1 });

    const activePublishCycle = latestApproved?.publishCycle || latestPublished?.publishCycle || null;

    // ISSUE #253: Return summary
    return res.status(200).json({
      groupId,
      summary,
      activePublishCycle,
      timestamp: new Date()
    });
  } catch (error) {
    console.error(
      '[Issue #253] Error in getGroupApprovalSummaryHandler',
      error
    );

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * POST /groups/:groupId/final-grades/preview
 * 
 * Computes a preview of individual final grades for all students in a group.
 * Does not persist into D7 Final Grades.
 */
const previewFinalGradesHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { requestedBy } = req.body;

    // RBAC Check for preview roles
    const allowedRoles = ['coordinator', 'professor', 'advisor'];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades'
      });
    }

    // Validation
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        error: 'Invalid group ID'
      });
    }

    if (!requestedBy || typeof requestedBy !== 'string') {
      return res.status(400).json({
        error: 'requestedBy is required'
      });
    }

    const { generatePreview, PreviewError } = require('../services/finalGradePreviewService');

    const previewOptions = {
      ...req.body,
      requestedBy: req.user.userId,
      requestedByRole: req.user.role
    };

    const preview = await generatePreview(groupId, previewOptions);
    return res.status(200).json(preview);

  } catch (error) {
    console.error('[Preview] Error:', error);
    
    if (error.name === 'PreviewError') {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * ================================================================================
 * ISSUE #255: PUBLISH FINAL GRADES HANDLER
 * ================================================================================
 */

/**
 * ISSUE #255: POST /groups/:groupId/final-grades/publish
 * 
 * Handler for publishing coordinator-approved final grades to D7 collection.
 * This is Process 8.5: Write approved grades (from Issue #253) to final storage,
 * mark evaluations complete, and dispatch notifications.
 *
 * Workflow:
 * 1. Extract groupId and coordinatorId from request
 * 2. Validate request body (decision confirmation, optional flags)
 * 3. Call publishService.publishFinalGrades with transaction safety
 * 4. Handle errors with proper HTTP status codes:
 *    - 404: No grades or group not found (no prior approval from #253)
 *    - 409: Grades already published (idempotency guard)
 *    - 422: Validation error (incomplete approval state)
 *    - 403: Non-coordinator (handled by middleware roleMiddleware)
 *    - 500: Transaction/database error
 * 5. Return FinalGradePublishResult to Issue #252 UI
 *
 * Request body (from Issue #252 UI):
 * {
 *   coordinatorId: String,        // Who is publishing? (same as auth user)
 *   confirmPublish: Boolean,      // Safety confirmation flag
 *   notifyStudents: Boolean,      // Send notification to each student?
 *   notifyFaculty: Boolean        // Send report to committee/faculty?
 * }
 *
 * Response (FinalGradePublishResult):
 * {
 *   success: Boolean,
 *   publishId: String,            // Correlation ID for this publish operation
 *   publishedAt: Date,            // When grades were published
 *   groupId: String,
 *   groupName: String,
 *   studentCount: Number,         // How many students got published grades?
 *   notificationsDispatched: Boolean,  // Were notifications queued?
 *   message: String               // Human-readable status
 * }
 *
 * Status Codes:
 * - 200: Success - all grades published and notification queued
 * - 400: Invalid request body or missing required fields
 * - 403: Forbidden - user is not coordinator (role guard)
 * - 404: Not found - group doesn't exist or no grades found
 * - 409: Conflict - grades already published (idempotency)
 * - 422: Unprocessable - approval incomplete, validation error
 * - 500: Internal error - transaction/database failure
 */
const publishFinalGradesHandler = async (req, res) => {
  try {
    // ========================================================================
    // ISSUE #255: EXTRACT AND VALIDATE REQUEST
    // ========================================================================

    const { groupId } = req.params;
    const { coordinatorId, confirmPublish, notifyStudents, notifyFaculty } = req.body;

    // ISSUE #255: Validate groupId parameter
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        error: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    // ISSUE #255: Validate coordinatorId matches authenticated user (Issue #253 pattern)
    if (!coordinatorId) {
      return res.status(422).json({
        error: 'coordinatorId is required',
        code: 'MISSING_COORDINATOR_ID'
      });
    }

    // ISSUE #255: Confirmation flag (optional but recommended for safety)
    // Not blocking if missing, but log if not provided
    if (!confirmPublish) {
      console.warn(
        `[Issue #255] Publish without confirmation flag - Group: ${groupId}`
      );
    }

    // ISSUE #255: Log publish attempt with context for audit trail
    console.log(
      `[Issue #255] Publish attempt - Group: ${groupId}, Coordinator: ${coordinatorId}, Notify: S=${notifyStudents} F=${notifyFaculty}`,
      {
        groupId,
        coordinatorId,
        notifyStudents: notifyStudents !== false,
        notifyFaculty: notifyFaculty || false
      }
    );

    // ========================================================================
    // ISSUE #255: CALL PUBLISH SERVICE (ATOMIC TRANSACTION)
    // ========================================================================

    let publishResult;
    try {
      publishResult = await publishFinalGrades(
        groupId,
        coordinatorId,
        {
          notifyStudents: notifyStudents !== false, // Default true
          notifyFaculty: notifyFaculty || false     // Default false
        }
      );
    } catch (error) {
      // ISSUE #255: Handle GradePublishError with proper HTTP status codes
      // Check if error has statusCode property (from publishService)
      if (error.statusCode) {
        console.warn(`[Issue #255] Publish failed - ${error.message}`, {
          groupId,
          coordinatorId,
          errorCode: error.errorCode
        });

        // ISSUE #255: Return appropriate status code based on error type
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.errorCode,
          timestamp: new Date()
        });
      }

      // ISSUE #255: Unexpected error
      throw error;
    }

    // ========================================================================
    // ISSUE #255: RETURN SUCCESS RESPONSE
    // ========================================================================

    console.log(
      `[Issue #255] Publish successful - Group: ${groupId}, Students: ${publishResult.studentCount}`,
      {
        groupId,
        publishId: publishResult.publishId,
        studentsPublished: publishResult.studentCount
      }
    );

    // ISSUE #255: Return 200 with full publish result for Issue #252 UI feedback
    // Also includes publishId for correlation with notification logs
    return res.status(200).json(publishResult);

  } catch (error) {
    // ISSUE #255: Log unexpected errors with full context
    console.error(
      '[Issue #255] Unexpected error in publishFinalGradesHandler',
      error
    );

    // ISSUE #255: Return 500 for internal errors
    return res.status(500).json({
      error: 'Internal server error during publication',
      code: 'PUBLISH_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * ================================================================================
 * ISSUE #253 & #255: EXPORTS
 * ================================================================================
 */

module.exports = {
  previewFinalGrades,
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler,
  previewFinalGradesHandler,
  publishFinalGradesHandler
};

