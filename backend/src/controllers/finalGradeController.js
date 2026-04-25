'use strict';

const finalGradePreviewService = require('../services/finalGradePreviewService');
const { approveGroupGrades, GradeApprovalError } = require('../services/approvalService');
const Group = require('../models/Group');
const AuditLog = require('../models/AuditLog');

const PREVIEW_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades';
const APPROVAL_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role may approve final grades';
const PUBLISH_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role may publish final grades';
const SYSTEM_ACTOR_ID = 'SYSTEM';

const isCoordinator = (req) => req?.user?.role === 'coordinator';
const hasValidSystemToken = (req) =>
  typeof req?.headers?.['x-system-auth'] === 'string' &&
  req.headers['x-system-auth'] === process.env.INTERNAL_SYSTEM_TOKEN;

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
    if (!isCoordinator(req)) {
      return res.status(403).json({
        error: APPROVAL_FORBIDDEN_MESSAGE,
        code: 'UNAUTHORIZED_ROLE'
      });
    }

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

    // ISSUE #253: Return summary
    return res.status(200).json({
      groupId,
      summary,
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
        error: PREVIEW_FORBIDDEN_MESSAGE,
        code: 'FORBIDDEN_PREVIEW_ACCESS'
      });
    }

    // Ownership guard: professor/advisor can preview only if assigned to the group.
    if (!isCoordinator(req)) {
      const group = await Group.findOne({ groupId }).select('advisorId professorId').lean();
      const requesterId = req.user.userId;
      const isAssigned =
        (req.user.role === 'advisor' && group?.advisorId === requesterId) ||
        (req.user.role === 'professor' && group?.professorId === requesterId);

      if (!isAssigned) {
        return res.status(403).json({
          error: PREVIEW_FORBIDDEN_MESSAGE,
          code: 'FORBIDDEN_PREVIEW_ACCESS'
        });
      }
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
 * POST /groups/:groupId/final-grades/publish
 *
 * Security gate endpoint for Process 8.5.
 * This handler currently enforces RBAC and returns a deterministic response.
 */
const publishFinalGradesHandler = async (req, res) => {
  const systemAccess = req?.isSystemBackend === true || hasValidSystemToken(req);
  const actorId = systemAccess ? SYSTEM_ACTOR_ID : (req?.user?.userId || null);
  if (!isCoordinator(req) && !systemAccess) {
    return res.status(403).json({
      error: PUBLISH_FORBIDDEN_MESSAGE,
      code: 'UNAUTHORIZED_ROLE'
    });
  }

  if (systemAccess) {
    try {
      await AuditLog.create({
        action: 'SYSTEM_ACCESS_AUDIT',
        actorId,
        groupId: req?.params?.groupId || null,
        payload: {
          endpoint: '/groups/:groupId/final-grades/publish',
          method: req.method,
          reason: 'publish_system_bypass',
          viaHeader: 'x-system-auth'
        },
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null
      });
    } catch (_auditError) {
      return res.status(500).json({
        error: 'System access audit logging failed',
        code: 'AUDIT_LOG_FAILURE'
      });
    }
  }

  try {
    await AuditLog.create({
      action: 'FINAL_GRADE_PUBLISHED',
      actorId,
      groupId: req?.params?.groupId || null,
      payload: {
        endpoint: '/groups/:groupId/final-grades/publish',
        method: req.method,
        accessMode: systemAccess ? 'system' : 'coordinator'
      },
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null
    });
  } catch (_publishAuditError) {
    return res.status(500).json({
      error: 'Final grade publish audit logging failed',
      code: 'AUDIT_LOG_FAILURE'
    });
  }

  return res.status(200).json({
    success: true,
    groupId: req.params.groupId,
    message: 'Final grades publish request accepted'
  });
};

/**
 * ================================================================================
 * ISSUE #253: EXPORTS
 * ================================================================================
 */

module.exports = {
  previewFinalGrades,
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler,
  previewFinalGradesHandler,
  publishFinalGradesHandler
};
