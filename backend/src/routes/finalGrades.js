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

// ISSUE #253: Import middleware for authentication & authorization
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// ISSUE #253: Import controller handlers
const {
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler
} = require('../controllers/finalGradeController');

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
  // ISSUE #253: Verify user has coordinator role (Process 4.2 role)
  roleMiddleware(['coordinator']),
  // ISSUE #253: Process approval request
  approveGroupGradesHandler
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
