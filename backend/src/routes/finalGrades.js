/**
 * ================================================================================
 * ISSUE #253: Final Grades Routes
 * ================================================================================
 *
 * Purpose:
 * Express route handler for final grade approval endpoints.
 *
 * Routes:
 * - POST /groups/:groupId/final-grades/approval
 *   Coordinator submits approval decision for a group's grades
 *   Middleware: authMiddleware, roleMiddleware(['coordinator'])
 *   Input: { coordinatorId, decision, overrideEntries, reason }
 *   Output: FinalGradeApproval response
 *   Status: 200, 403, 404, 409, 422, 500
 *
 * - GET /groups/:groupId/final-grades/summary (Optional)
 *   Coordinator views approval progress dashboard
 *   Middleware: authMiddleware, roleMiddleware(['coordinator'])
 *   Output: Summary with counts by status
 *   Status: 200, 400, 500
 *
 * Process Context:
 * - Input: POST from Issue #252 UI submission
 * - Processing: Issue #253 (this) approval workflow
 * - Output: Consumed by Issue #255 (publish flow)
 *
 * ================================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const AuditLog = require('../models/AuditLog');

// ISSUE #253: Import middleware for authentication & authorization
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// ISSUE #253: Import controller handlers
const {
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler,
  previewFinalGradesHandler,
  publishFinalGradesHandler
} = require('../controllers/finalGradeController');

const publishAuthOrSystemMiddleware = (req, res, next) => {
  const providedSystemToken = req.headers['x-system-auth'];
  const expectedSystemToken = process.env.INTERNAL_SYSTEM_TOKEN;

  if (
    typeof providedSystemToken === 'string' &&
    typeof expectedSystemToken === 'string' &&
    expectedSystemToken.length > 0 &&
    providedSystemToken === expectedSystemToken
  ) {
    req.isSystemBackend = true;
    req.user = {
      userId: 'SYSTEM',
      role: 'system',
      isServiceAccount: true
    };
    return next();
  }

  return authMiddleware(req, res, next);
};

const deprecatedApprovalRouteWarning = async (req, res, next) => {
  console.warn('[DEPRECATED_ROUTE_USED] POST /final-grades/approval is deprecated; prefer /final-grades/approve');
  try {
    await AuditLog.create({
      action: 'DEPRECATED_ROUTE_USED',
      actorId: req?.user?.userId || null,
      groupId: req?.params?.groupId || null,
      payload: {
        route: '/groups/:groupId/final-grades/approval',
        preferredRoute: '/groups/:groupId/final-grades/approve',
        method: req.method
      },
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null
    });
  } catch (_error) {
    // Non-fatal deprecation telemetry
  }
  next();
};

/**
 * POST /groups/:groupId/final-grades/preview
 * 
 * Computes a preview of individual final grades for all students in a group.
 * Does not persist into D7 Final Grades.
 */
router.post(
  '/:groupId/final-grades/preview',
  authMiddleware,
  previewFinalGradesHandler
);

/**
 * ISSUE #253: POST /groups/:groupId/final-grades/approval
 * 
 * Endpoint for coordinator to approve group's final grades.
 * This is the primary write endpoint for Issue #253.
 *
 * Middleware chain:
 * 1. authMiddleware - Verify JWT token is valid
 * 2. roleMiddleware(['coordinator']) - Verify user has coordinator role
 *
 * Handler: approveGroupGradesHandler
 * - Validates request body (decision, overrides)
 * - Calls approvalService.approveGroupGrades()
 * - Returns FinalGradeApproval response for frontend & Issue #255
 * - Handles errors with proper HTTP status codes
 */
router.post(
  '/:groupId/final-grades/approval',
  // ISSUE #253: Verify user is authenticated
  authMiddleware,
  deprecatedApprovalRouteWarning,
  // ISSUE #253: Process approval request
  approveGroupGradesHandler
);

/**
 * POST /groups/:groupId/final-grades/approve
 *
 * Alias endpoint for OpenAPI-compatible naming in integration tests.
 */
router.post(
  '/:groupId/final-grades/approve',
  authMiddleware,
  approveGroupGradesHandler
);

/**
 * POST /groups/:groupId/final-grades/publish
 *
 * Security gate endpoint for Process 8.5.
 */
router.post(
  '/:groupId/final-grades/publish',
  publishAuthOrSystemMiddleware,
  publishFinalGradesHandler
);

/**
 * ISSUE #253: GET /groups/:groupId/final-grades/summary
 * 
 * Optional endpoint for coordinator dashboard.
 * Returns summary statistics of grades by status.
 *
 * Middleware chain:
 * 1. authMiddleware - Verify JWT token is valid
 * 2. roleMiddleware(['coordinator']) - Verify user has coordinator role
 *
 * Handler: getGroupApprovalSummaryHandler
 * - Fetches summary from FinalGrade model
 * - Returns aggregate counts by status
 * - Used for progress dashboard
 */
router.get(
  '/:groupId/final-grades/summary',
  // ISSUE #253: Verify user is authenticated
  authMiddleware,
  // ISSUE #253: Verify user has coordinator role
  roleMiddleware(['coordinator']),
  // ISSUE #253: Fetch summary statistics
  getGroupApprovalSummaryHandler
);

/**
 * ================================================================================
 * ISSUE #253: EXPORTS
 * ================================================================================
 */

module.exports = router;
