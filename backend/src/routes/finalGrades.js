/**
 * ================================================================================
 * Final Grades Routes
 * ================================================================================
 *
 * Purpose:
 * Express route handler for final grade preview, approval, and publication.
 *
 * Routes:
 * - POST /groups/:groupId/final-grades/preview
 *   Preview individual final grades (Process 8.1-8.3)
 *
 * - POST /groups/:groupId/final-grades/approve (Alias: /approval)
 *   Coordinator submits approval decision (Process 8.4)
 *
 * - GET /groups/:groupId/final-grades/summary
 *   Coordinator views approval progress dashboard
 *
 * - POST /groups/:groupId/final-grades/publish
 *   Store & Publish Final Grades (Process 8.5)
 *   Supports both Coordinator and System Backend via x-system-auth header.
 *
 * ================================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const AuditLog = require('../models/AuditLog');

// Import middleware for authentication & authorization
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

// Import controller handlers
const {
  previewFinalGradesHandler,
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler,
  previewFinalGradesHandler,
  publishFinalGradesHandler
} = require('../controllers/finalGradeController');

router.post(
  '/:groupId/final-grades/preview',
  authMiddleware,
  roleMiddleware(['coordinator', 'professor', 'advisor']),
  previewFinalGradesHandler
);

/**
 * Middleware for Process 8.5 Publication
 * Allows both Coordinator (via JWT) and System Backend (via header token).
 */
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

/**
 * Legacy route warning for telemetry.
 */
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
 * Computes a preview of individual final grades for all students in a group.
 */
router.post(
  '/:groupId/final-grades/preview',
  authMiddleware,
  previewFinalGradesHandler
);

/**
 * POST /groups/:groupId/final-grades/approve
 * Endpoint for coordinator to approve group's final grades (Process 8.4).
 */
router.post(
  '/:groupId/final-grades/approve',
  authMiddleware,
  roleMiddleware(['coordinator']),
  approveGroupGradesHandler
);

/**
 * POST /groups/:groupId/final-grades/approval (LEGACY)
 */
router.post(
  '/:groupId/final-grades/approval',
  authMiddleware,
  roleMiddleware(['coordinator']),
  deprecatedApprovalRouteWarning,
  approveGroupGradesHandler
);

/**
 * GET /groups/:groupId/final-grades/summary
 * Returns summary statistics of grades by status.
 */
router.get(
  '/:groupId/final-grades/summary',
  authMiddleware,
  roleMiddleware(['coordinator']),
  getGroupApprovalSummaryHandler
);

/**
 * POST /groups/:groupId/final-grades/publish
 * Endpoint for coordinator or system backend to publish grades (Process 8.5).
 */
router.post(
  '/:groupId/final-grades/publish',
  publishAuthOrSystemMiddleware,
  publishFinalGradesHandler
);

module.exports = router;
