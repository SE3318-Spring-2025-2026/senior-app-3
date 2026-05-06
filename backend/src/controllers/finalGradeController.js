'use strict';

const { approveGroupGrades, GradeApprovalError } = require('../services/approvalService');
const Group = require('../models/Group');
const AuditLog = require('../models/AuditLog');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
const { publishFinalGrades } = require('../services/publishService');
const { v4: uuidv4 } = require('uuid');
const { generatePreview } = require('../services/finalGradePreviewService');
const {
  FinalGradeReadError,
  getPublishedGradesForGroup,
  getPublishedGradesForStudent
} = require('../services/finalGradeReadService');

const PREVIEW_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades';
const PREVIEW_GROUP_ACCESS_DENIED_MESSAGE =
  'Access denied: You are not assigned as an advisor or professor for this group.';
const APPROVAL_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role may approve final grades';
const PUBLISH_FORBIDDEN_MESSAGE =
  'Forbidden - only the Coordinator role or authorized system backend may publish final grades';
const SYSTEM_ACTOR_ID = 'SYSTEM';

const isCoordinator = (req) => req?.user?.role === 'coordinator';
const hasValidSystemToken = (req) =>
  typeof req?.headers?.['x-system-auth'] === 'string' &&
  req.headers['x-system-auth'] === process.env.INTERNAL_SYSTEM_TOKEN;

const handleFinalGradeReadError = (res, error) => {
  if (error instanceof FinalGradeReadError) {
    return res.status(error.statusCode).json({
      message: error.message,
      code: error.errorCode,
      timestamp: new Date()
    });
  }

  console.error('[Published Final Grades] Unexpected read error', error);
  return res.status(500).json({
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date()
  });
};

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

  // Refresh same-cycle pending snapshot by removing rows that are no longer
  // part of the generated preview.
  await FinalGrade.deleteMany({
    groupId,
    publishCycle,
    status: FINAL_GRADE_STATUS.PENDING,
    studentId: { $nin: incomingStudentIds }
  });

  // Supersede prior non-published rows for the incoming students so that a
  // freshly generated preview snapshot represents the single active draft.
  // This prevents stale PENDING/APPROVED rows from older preview cycles
  // accumulating and blocking publish eligibility (notApprovedCount>0 → 422).
  // PUBLISHED rows are never touched (they are immutable history).
  await FinalGrade.deleteMany({
    groupId,
    studentId: { $in: incomingStudentIds },
    status: { $ne: FINAL_GRADE_STATUS.PUBLISHED }
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
        error: PREVIEW_FORBIDDEN_MESSAGE,
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
          error: PREVIEW_FORBIDDEN_MESSAGE,
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

    const wantsApprovalSnapshot = req.body?.persistForApproval === true;

    if (wantsApprovalSnapshot && !isCoordinator(req)) {
      return res.status(403).json({
        error: PREVIEW_FORBIDDEN_MESSAGE,
        message: PREVIEW_FORBIDDEN_MESSAGE,
        code: 'FORBIDDEN_PREVIEW_ACCESS'
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
            error: error.message,
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
        error: error.message,
        message: error.message,
        code: error.code || 'PREVIEW_ERROR',
        ...(error.details ? { details: error.details } : {})
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error',
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
 * ISSUE #258 / Script #255: GET /groups/:groupId/final-grades?status=published
 * Reads only published final grades from D7 with strict group/student RBAC.
 */
const getPublishedGroupFinalGradesHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : null;

    if (statusFilter && statusFilter !== FINAL_GRADE_STATUS.PUBLISHED) {
      return res.status(400).json({
        message: 'Invalid status filter. Only "published" is supported.',
        code: 'INVALID_STATUS_FILTER',
        timestamp: new Date()
      });
    }

    const grades = await getPublishedGradesForGroup(groupId, req.user);

    return res.status(200).json({
      groupId,
      status: FINAL_GRADE_STATUS.PUBLISHED,
      grades
    });
  } catch (error) {
    return handleFinalGradeReadError(res, error);
  }
};

/**
 * ISSUE #258 / Script #255: GET /me/final-grades
 * Student self-view for published final grades only.
 */
const getMyPublishedFinalGradesHandler = async (req, res) => {
  try {
    const grades = await getPublishedGradesForStudent(req.user);

    return res.status(200).json({
      studentId: req.user.userId,
      status: FINAL_GRADE_STATUS.PUBLISHED,
      grades
    });
  } catch (error) {
    return handleFinalGradeReadError(res, error);
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
    const { notifyStudents, notifyFaculty, publishCycle, notificationFlags } = req.body;
    const normalizedFlags =
      notificationFlags && typeof notificationFlags === 'object' && !Array.isArray(notificationFlags)
        ? {
            email: Boolean(notificationFlags.email),
            sms: Boolean(notificationFlags.sms),
            push: Boolean(notificationFlags.push)
          }
        : {
            email: notifyStudents !== false,
            sms: false,
            push: false
          };

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

    console.log(
      `[Issue #255] Publish attempt - Group: ${groupId}, Actor: ${actorId}, flags=${JSON.stringify(
        normalizedFlags
      )} F=${notifyFaculty || false}`
    );

    let publishResult;
    try {
      publishResult = await publishFinalGrades(
        groupId,
        actorId,
        {
          publishCycle: publishCycle || null,
          notificationFlags: normalizedFlags,
          notifyFaculty: notifyFaculty || false
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

/**
 * GET /groups/:groupId/final-grades/review
 * Read-only snapshot for professor/advisor review.
 * Auto-generates and persists a preview if none exists yet.
 */
const getGradeReviewHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const requester = req.user;

    const allowedRoles = ['coordinator', 'professor', 'advisor'];
    if (!requester || !allowedRoles.includes(requester.role)) {
      return res.status(403).json({ message: PREVIEW_FORBIDDEN_MESSAGE, code: 'FORBIDDEN' });
    }

    if (!isCoordinator(req)) {
      const group = await Group.findOne({ groupId }).select('advisorId professorId').lean();
      const isAssigned =
        (requester.role === 'advisor' && group?.advisorId === requester.userId) ||
        (requester.role === 'professor' && group?.professorId === requester.userId);
      if (!isAssigned) {
        return res.status(403).json({ message: PREVIEW_GROUP_ACCESS_DENIED_MESSAGE, code: 'FORBIDDEN' });
      }
    }

    // Find the latest publish cycle that has pending or approved grades
    let latestRecord = await FinalGrade.findOne({
      groupId,
      status: { $in: [FINAL_GRADE_STATUS.PENDING, FINAL_GRADE_STATUS.APPROVED] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    // Auto-generate and persist a preview if none exists
    if (!latestRecord) {
      let autoPreview;
      try {
        autoPreview = await generatePreview(groupId, { allowMissingRatios: true });
      } catch (previewError) {
        // Fall back to equal-ratio distribution from the group's member list
        const groupDoc = await Group.findOne({ groupId }).lean();
        const memberIds = (groupDoc?.members || [])
          .filter((m) => m.status === 'accepted' && m.userId)
          .map((m) => m.userId);
        if (memberIds.length === 0 && groupDoc?.leaderId) memberIds.push(groupDoc.leaderId);

        if (memberIds.length === 0) {
          return res.status(404).json({ message: 'No grade preview has been generated for this group yet.', code: 'NO_PREVIEW' });
        }

        const equalRatio = Math.round((1 / memberIds.length) * 10000) / 10000;
        const baseGroupScore = 100;
        autoPreview = {
          groupId,
          baseGroupScore,
          createdAt: new Date(),
          students: memberIds.map((studentId) => ({
            studentId,
            contributionRatio: equalRatio,
            computedFinalGrade: Math.round(baseGroupScore * equalRatio * 100) / 100,
            deliverableScoreBreakdown: {},
          })),
        };
      }

      if (!Array.isArray(autoPreview?.students) || autoPreview.students.length === 0) {
        return res.status(404).json({ message: 'No grade preview has been generated for this group yet.', code: 'NO_PREVIEW' });
      }

      const publishCycle = buildPublishCycle(groupId);
      try {
        await persistPreviewForApproval({
          groupId,
          preview: autoPreview,
          publishCycle,
          coordinatorId: 'system_auto',
        });
      } catch (persistError) {
        console.warn('[GradeReview] Auto-persist failed:', persistError.message);
        return res.status(404).json({ message: 'No grade preview has been generated for this group yet.', code: 'NO_PREVIEW' });
      }

      latestRecord = await FinalGrade.findOne({
        groupId,
        status: FINAL_GRADE_STATUS.PENDING,
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      if (!latestRecord) {
        return res.status(404).json({ message: 'No grade preview has been generated for this group yet.', code: 'NO_PREVIEW' });
      }
    }

    const { publishCycle } = latestRecord;

    const gradeRecords = await FinalGrade.find({
      groupId,
      publishCycle,
      status: { $in: [FINAL_GRADE_STATUS.PENDING, FINAL_GRADE_STATUS.APPROVED] },
    }).lean();

    const students = gradeRecords.map((g) => ({
      studentId: g.studentId,
      contributionRatio: g.individualRatio,
      computedFinalGrade: g.computedFinalGrade,
      deliverableScoreBreakdown: {},
    }));

    const approvedRecord = gradeRecords.find((g) => g.status === FINAL_GRADE_STATUS.APPROVED);
    const overrideEntries = gradeRecords
      .filter((g) => g.overrideApplied && g.overriddenFinalGrade != null)
      .map((g) => ({
        studentId: g.studentId,
        overriddenFinalGrade: g.overriddenFinalGrade,
        comment: g.overrideComment || null,
      }));

    const approval = approvedRecord
      ? {
          decision: 'approved',
          coordinatorId: approvedRecord.approvedBy,
          approvedAt: approvedRecord.approvedAt,
          overridesApplied: overrideEntries.length > 0,
          overrideEntries,
        }
      : null;

    return res.status(200).json({
      status: approval ? 'approved' : 'preview_ready',
      preview: {
        groupId,
        publishCycle,
        baseGroupScore: latestRecord.baseGroupScore,
        createdAt: latestRecord.createdAt,
        students,
      },
      approval,
    });
  } catch (error) {
    console.error('[GradeReview] Error:', error);
    return res.status(500).json({ message: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
};

module.exports = {
  previewFinalGradesHandler,
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler,
  getPublishedGroupFinalGradesHandler,
  getMyPublishedFinalGradesHandler,
  publishFinalGradesHandler,
  getGradeReviewHandler,
};
