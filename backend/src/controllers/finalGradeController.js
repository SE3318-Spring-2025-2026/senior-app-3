'use strict';

const finalGradePreviewService = require('../services/finalGradePreviewService');
const { approveGroupGrades, GradeApprovalError } = require('../services/approvalService');
const Group = require('../models/Group');
const AuditLog = require('../models/AuditLog');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
const { publishFinalGrades } = require('../services/publishService');
const { v4: uuidv4 } = require('uuid');

const PREVIEW_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades';
const APPROVAL_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role may approve final grades';
const PUBLISH_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role or authorized system backend may publish final grades';
const SYSTEM_ACTOR_ID = 'SYSTEM';

const isCoordinator = (req) => req?.user?.role === 'coordinator';
const hasValidSystemToken = (req) =>
  typeof req?.headers?.['x-system-auth'] === 'string' &&
  req.headers['x-system-auth'] === process.env.INTERNAL_SYSTEM_TOKEN;

const buildPublishCycle = (groupId) =>
  `cycle_${String(groupId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}_${uuidv4().split('-')[0]}`;

const normalizeApprovalDecision = (decision) => {
  if (typeof decision !== 'string') return null;
  const normalized = decision.trim().toLowerCase();
  if (normalized === 'approved') return 'approve';
  if (normalized === 'rejected') return 'reject';
  if (normalized === 'approve' || normalized === 'reject') return normalized;
  return null;
};

const persistPreviewForApproval = async ({
  groupId,
  preview,
  publishCycle,
  coordinatorId
}) => {
  const students = Array.isArray(preview?.students) ? preview.students : [];

  if (students.length === 0) {
    const error = new Error('Preview does not contain student grade entries to approve');
    error.statusCode = 404;
    error.code = 'NO_PREVIEW_STUDENTS';
    throw error;
  }

  const hasTerminalGrades = await FinalGrade.hasTerminalGrades(groupId, publishCycle);
  if (hasTerminalGrades) {
    const error = new Error('Grades for this group and cycle are already approved, rejected, or published');
    error.statusCode = 409;
    error.code = 'CYCLE_ALREADY_TERMINAL';
    throw error;
  }

  const now = new Date();
  const incomingStudentIds = students.map((student) => student.studentId);

  // Refresh pending snapshot for this cycle to avoid stale/duplicate pending states.
  await FinalGrade.deleteMany({
    groupId,
    publishCycle,
    status: FINAL_GRADE_STATUS.PENDING,
    studentId: { $nin: incomingStudentIds }
  });

  for (const student of students) {
    await FinalGrade.findOneAndUpdate(
      {
        groupId,
        publishCycle,
        studentId: student.studentId,
        status: FINAL_GRADE_STATUS.PENDING
      },
      {
        $set: {
          groupId,
          publishCycle,
          studentId: student.studentId,
          baseGroupScore: preview.baseGroupScore,
          individualRatio: student.contributionRatio,
          computedFinalGrade: student.computedFinalGrade,
          status: FINAL_GRADE_STATUS.PENDING,
          updatedAt: now
        },
        $setOnInsert: {
          finalGradeId: `fg_${uuidv4().split('-')[0]}`,
          createdAt: now
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );
  }

  try {
    await AuditLog.create({
      action: 'FINAL_GRADE_PREVIEW_PERSISTED',
      actorId: coordinatorId,
      groupId,
      payload: {
        publishCycle,
        studentCount: students.length,
        persistedAt: now
      }
    });
  } catch (_error) {
    // Non-fatal audit telemetry
  }
};

/**
 * Controller for Process 8.1 - Final Grade Preview
 * Computes a preview of individual final grades for all students in a group.
 * Does not persist into D7 Final Grades.
 */
const previewFinalGradesHandler = async (req, res) => {
  try {
    const { groupId } = req.params;

    // RBAC Check for preview roles
    const allowedRoles = ['coordinator', 'professor', 'advisor'];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: PREVIEW_FORBIDDEN_MESSAGE,
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
          message: PREVIEW_FORBIDDEN_MESSAGE,
          code: 'FORBIDDEN_PREVIEW_ACCESS'
        });
      }
    }

    // Validation
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        message: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    const { generatePreview, PreviewError } = require('../services/finalGradePreviewService');

    const wantsApprovalSnapshot = req.body?.persistForApproval === true;

    if (wantsApprovalSnapshot && !isCoordinator(req)) {
      return res.status(403).json({
        message: APPROVAL_FORBIDDEN_MESSAGE,
        code: 'UNAUTHORIZED_ROLE'
      });
    }

    const previewOptions = {
      ...req.body,
      requestedBy: req.user.userId,
      requestedByRole: req.user.role
    };

    const preview = await generatePreview(groupId, previewOptions);
    const createdAt = new Date();
    const responsePayload = {
      ...preview,
      groupId: preview.groupId || groupId,
      createdAt
    };

    if (wantsApprovalSnapshot) {
      const publishCycle =
        typeof req.body?.publishCycle === 'string' && req.body.publishCycle.trim() !== ''
          ? req.body.publishCycle.trim()
          : buildPublishCycle(groupId);

      try {
        await persistPreviewForApproval({
          groupId,
          preview: responsePayload,
          publishCycle,
          coordinatorId: req.user.userId
        });
      } catch (error) {
        if (error.statusCode) {
          return res.status(error.statusCode).json({
            message: error.message,
            code: error.code || 'PREVIEW_PERSIST_FAILED'
          });
        }
        throw error;
      }

      responsePayload.publishCycle = publishCycle;
      responsePayload.persistedForApproval = true;
    }

    return res.status(200).json({
      ...responsePayload
    });

  } catch (error) {
    console.error('[Preview] Error:', error);
    
    if (error.name === 'PreviewError' || error.status === 400 || error.status === 409) {
      return res.status(error.status || error.statusCode || 400).json({ 
        message: error.message,
        code: error.code || 'PREVIEW_ERROR'
      });
    }

    return res.status(500).json({ 
      message: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * ISSUE #253: POST /groups/:groupId/final-grades/approve
 * Endpoint for coordinator to approve group's final grades.
 */
const approveGroupGradesHandler = async (req, res) => {
  try {
    if (!isCoordinator(req)) {
      return res.status(403).json({
        message: APPROVAL_FORBIDDEN_MESSAGE,
        code: 'UNAUTHORIZED_ROLE'
      });
    }

    const { groupId } = req.params;
    let { publishCycle, decision, overrideEntries, reason } = req.body;
    const coordinatorId = req.user.userId;

    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        message: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    if (!coordinatorId) {
      return res.status(422).json({
        message: 'Authenticated coordinator identity is missing',
        code: 'MISSING_AUTH_USER_ID'
      });
    }

    if (!publishCycle || typeof publishCycle !== 'string' || publishCycle.trim() === '') {
      const latestPending = await FinalGrade.findOne({
        groupId,
        status: FINAL_GRADE_STATUS.PENDING
      }).sort({ updatedAt: -1, createdAt: -1 }).lean();

      publishCycle = latestPending?.publishCycle || null;

      if (!publishCycle) {
        return res.status(422).json({
          message: 'publishCycle is required',
          code: 'MISSING_PUBLISH_CYCLE'
        });
      }
    }

    const normalizedDecision = normalizeApprovalDecision(decision);
    if (!normalizedDecision) {
      return res.status(422).json({
        message: 'decision must be one of "approve", "reject", "APPROVED", or "REJECTED"',
        code: 'INVALID_DECISION'
      });
    }
    decision = normalizedDecision;

    console.log(`[Issue #253] Approval attempt - Group: ${groupId}, Coordinator: ${coordinatorId}, Decision: ${decision}`);

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
      if (error instanceof GradeApprovalError) {
        console.warn(`[Issue #253] Approval failed - ${error.message}`);
        return res.status(error.statusCode).json({
          message: error.message,
          code: error.errorCode,
          timestamp: new Date()
        });
      }
      throw error;
    }

    console.log(`[Issue #253] Approval successful - Group: ${groupId}, Decision: ${decision}`);
    return res.status(200).json(approvalResult);

  } catch (error) {
    console.error('[Issue #253] Unexpected error in approveGroupGradesHandler', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * ISSUE #253: GET /groups/:groupId/final-grades/summary
 * Returns summary statistics of grades by status.
 */
const getGroupApprovalSummaryHandler = async (req, res) => {
  try {
    const { groupId } = req.params;

    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        message: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    const { getGroupApprovalSummary } = require('../services/approvalService');
    const summary = await getGroupApprovalSummary(groupId);

    const latestApproved = await FinalGrade.findOne({
      groupId,
      status: FINAL_GRADE_STATUS.APPROVED
    }).sort({ approvedAt: -1, updatedAt: -1 });

    const latestPublished = await FinalGrade.findOne({
      groupId,
      status: FINAL_GRADE_STATUS.PUBLISHED
    }).sort({ publishedAt: -1, updatedAt: -1 });

    const activePublishCycle = latestApproved?.publishCycle || latestPublished?.publishCycle || null;

    return res.status(200).json({
      groupId,
      summary,
      activePublishCycle,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('[Issue #253] Error in getGroupApprovalSummaryHandler', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * ISSUE #255: POST /groups/:groupId/final-grades/publish
 * Handler for publishing coordinator-approved final grades to D7 collection.
 */
const publishFinalGradesHandler = async (req, res) => {
  try {
    const systemAccess = req?.isSystemBackend === true || hasValidSystemToken(req);
    const actorId = systemAccess ? SYSTEM_ACTOR_ID : (req?.user?.userId || null);

    // RBAC Check
    if (!isCoordinator(req) && !systemAccess) {
      return res.status(403).json({
        message: PUBLISH_FORBIDDEN_MESSAGE,
        code: 'UNAUTHORIZED_ROLE'
      });
    }

    const { groupId } = req.params;
    const { notifyStudents, notifyFaculty } = req.body;

    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        message: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    // System access audit logging
    if (systemAccess) {
      try {
        await AuditLog.create({
          action: 'SYSTEM_ACCESS_AUDIT',
          actorId,
          groupId,
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
        console.error('System access audit logging failed', _auditError);
      }
    }

    console.log(`[Issue #255] Publish attempt - Group: ${groupId}, Actor: ${actorId}, Notify: S=${notifyStudents} F=${notifyFaculty}`);

    let publishResult;
    try {
      publishResult = await publishFinalGrades(
        groupId,
        actorId,
        {
          notifyStudents: notifyStudents !== false, // Default true
          notifyFaculty: notifyFaculty || false     // Default false
        }
      );
    } catch (error) {
      if (error.statusCode) {
        console.warn(`[Issue #255] Publish failed - ${error.message}`, {
          groupId,
          actorId,
          errorCode: error.errorCode
        });

        return res.status(error.statusCode).json({
          message: error.message,
          code: error.errorCode,
          timestamp: new Date()
        });
      }
      throw error;
    }

    // FINAL_GRADE_PUBLISHED audit log (already logged in service, but adding controller-level if needed)
    // Actually, let's keep the controller-level audit log as well for request tracking
    try {
      await AuditLog.create({
        action: 'FINAL_GRADE_PUBLISHED',
        actorId,
        groupId,
        payload: {
          endpoint: '/groups/:groupId/final-grades/publish',
          method: req.method,
          accessMode: systemAccess ? 'system' : 'coordinator'
        },
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null
      });
    } catch (_publishAuditError) {
      // Non-fatal
    }

    console.log(`[Issue #255] Publish successful - Group: ${groupId}, Students: ${publishResult.studentCount}`);
    return res.status(200).json(publishResult);

  } catch (error) {
    console.error('[Issue #255] Unexpected error in publishFinalGradesHandler', error);
    return res.status(500).json({
      message: 'Internal server error during publication',
      code: 'PUBLISH_ERROR',
      timestamp: new Date()
    });
  }
};

module.exports = {
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler,
  previewFinalGradesHandler,
  publishFinalGradesHandler
};
