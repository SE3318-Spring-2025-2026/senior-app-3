'use strict';

const { v4: uuidv4 } = require('uuid');
const Group = require('../models/Group');
const SprintRecord = require('../models/SprintRecord');
const { createAuditLog } = require('../services/auditService');
const { dispatchSprintUpdateNotifications } = require('../services/sprintNotificationService');
const { recalculateSprintContributions } = require('../services/contributionRecalculateService');

async function requireCoordinatorRole(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    if (!['coordinator', 'admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Coordinator role required',
        code: 'UNAUTHORIZED_ROLE',
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
}

async function recalculateContributions(req, res) {
  const correlationId = `contrib_${Date.now()}_${uuidv4().substring(0, 8)}`;
  const startTime = Date.now();

  try {
    const coordinatorId = req.user.userId || req.user._id;
    const { groupId, sprintId } = req.params;
    const {
      notifyStudents = false,
      notifyCoordinator = true,
      overrideFinalized = false,
      persistToD4 = true,
      notes = '',
    } = req.body || {};

    if (!groupId || !sprintId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: groupId and sprintId',
        code: 'MISSING_PARAMETERS',
        correlationId,
      });
    }

    const group = await Group.findOne({ groupId }).lean();
    if (!group) {
      return res.status(404).json({
        success: false,
        error: `Group ${groupId} not found`,
        code: 'GROUP_NOT_FOUND',
        correlationId,
      });
    }

    const sprint = await SprintRecord.findOne({ sprintId, groupId }).lean();
    if (!sprint) {
      return res.status(404).json({
        success: false,
        error: `Sprint ${sprintId} not found`,
        code: 'SPRINT_NOT_FOUND',
        correlationId,
      });
    }

    await createAuditLog({
      action: 'SPRINT_CONTRIBUTION_RECALCULATION_INITIATED',
      actorId: coordinatorId,
      targetId: groupId,
      groupId,
      payload: {
        sprintId,
        notifyStudents,
        notifyCoordinator,
        overrideFinalized,
        correlationId,
        notes: String(notes).substring(0, 500),
      },
    }).catch(() => {});

    const recalculationSummary = await recalculateSprintContributions(sprintId, groupId, {
      overrideExisting: overrideFinalized,
      notifyStudents,
      notifyCoordinator,
      persistToD4,
    });

    const ratioResult = {
      sprintId,
      groupId,
      contributions: (recalculationSummary.contributions || []).map((entry) => ({
        studentId: entry.studentId,
        targetStoryPoints: entry.targetPoints,
        completedStoryPoints: entry.completedPoints,
        contributionRatio: entry.contributionRatio,
      })),
      groupTotalStoryPoints: recalculationSummary.attribution?.totalStoryPoints || 0,
      averageRatio: recalculationSummary.metrics?.averageRatio || 0,
      maxRatio: (recalculationSummary.contributions || []).reduce(
        (max, entry) => Math.max(max, entry.contributionRatio),
        0
      ),
      minRatio: (recalculationSummary.contributions || []).reduce(
        (min, entry) => Math.min(min, entry.contributionRatio),
        Number.POSITIVE_INFINITY
      ),
      strategyUsed: 'recalculate_service',
      recalculatedAt: recalculationSummary.recalculatedAt || new Date(),
      correlationId,
    };
    if (!Number.isFinite(ratioResult.minRatio)) ratioResult.minRatio = 0;

    if (!ratioResult.contributions.length) {
      return res.status(422).json({
        success: false,
        error: 'Ratio calculation produced no contributions',
        code: 'EMPTY_CONTRIBUTION_LIST',
        correlationId,
      });
    }

    const persistenceResult = {
      success: recalculationSummary.success === true,
      recordsPersistedCount: ratioResult.contributions.length,
      d4RecordCreated: persistToD4,
      persistedAt: recalculationSummary.recalculatedAt || new Date(),
      durationMs: Date.now() - startTime,
      code: recalculationSummary.code,
      status: recalculationSummary.status,
      message: recalculationSummary.message,
    };

    if (!persistenceResult.success && persistenceResult.code === 'SPRINT_FINALIZED_CONFLICT') {
      return res.status(409).json({
        success: false,
        error: 'Cannot recompute: Sprint is finalized',
        code: 'SPRINT_FINALIZED_CONFLICT',
        correlationId,
      });
    }

    if (!persistenceResult.success && persistenceResult.status === 422) {
      return res.status(422).json({
        success: false,
        error: persistenceResult.message || 'Validation error in persistence',
        code: persistenceResult.code || 'UNPROCESSABLE_ENTITY',
        correlationId,
      });
    }

    if (!persistenceResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Persistence service failed',
        code: 'D6_UPSERT_FAILED',
        correlationId,
      });
    }

    setImmediate(async () => {
      try {
        await dispatchSprintUpdateNotifications(groupId, sprintId, ratioResult, coordinatorId, correlationId, {
          notifyStudents,
          notifyCoordinator,
        });
      } catch (_err) {
        await createAuditLog({
          action: 'SPRINT_NOTIFICATION_DISPATCHER_ERROR',
          actorId: 'system',
          groupId,
          payload: { sprintId, correlationId, phase: 'non_blocking_dispatch' },
        }).catch(() => {});
      }
    });

    await createAuditLog({
      action: 'SPRINT_CONTRIBUTION_RECALCULATION_COMPLETED',
      actorId: coordinatorId,
      targetId: groupId,
      groupId,
      payload: {
        sprintId,
        recordsPersistedCount: persistenceResult.recordsPersistedCount,
        d4RecordCreated: persistenceResult.d4RecordCreated,
        durationMs: Date.now() - startTime,
        correlationId,
      },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      sprintId,
      groupId,
      coordinatorId,
      ratiosCalculated: true,
      contributionCount: ratioResult.contributions.length,
      persistenceResult: {
        success: persistenceResult.success,
        recordsPersistedCount: persistenceResult.recordsPersistedCount,
        d4RecordCreated: persistenceResult.d4RecordCreated,
        persistedAt: persistenceResult.persistedAt,
        durationMs: persistenceResult.durationMs,
      },
      reconciliationResult: null,
      notificationResult: {
        success: true,
        studentNotificationCount: notifyStudents ? ratioResult.contributions.length : 0,
        coordinatorNotified: notifyCoordinator,
        dispatchMethod: 'async',
        correlationId,
      },
      contributionSummary: {
        contributions: ratioResult.contributions,
        groupTotalStoryPoints: ratioResult.groupTotalStoryPoints,
        averageRatio: ratioResult.averageRatio,
        maxRatio: ratioResult.maxRatio,
        minRatio: ratioResult.minRatio,
        strategyUsed: ratioResult.strategyUsed,
        recalculatedAt: ratioResult.recalculatedAt,
      },
      correlationId,
      processedAt: new Date(),
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    if (error?.code === 'SPRINT_LOCKED') {
      return res.status(422).json({
        success: false,
        error: 'Cannot recompute: Sprint window is closed',
        code: 'SPRINT_WINDOW_CLOSED',
        correlationId,
      });
    }

    if (error && Number.isInteger(error.status) && error.code) {
      return res.status(error.status).json({
        success: false,
        error: error.message || 'Contribution recalculation failed',
        code: error.code,
        correlationId,
      });
    }

    await createAuditLog({
      action: 'SPRINT_CONTRIBUTION_RECALCULATION_ERROR',
      actorId: req.user?.userId || req.user?._id || 'system',
      targetId: req.params.groupId,
      groupId: req.params.groupId,
      payload: {
        sprintId: req.params.sprintId,
        error: error.message,
        correlationId,
      },
    }).catch(() => {});

    return res.status(500).json({
      success: false,
      error: 'Internal server error during contribution recalculation',
      code: 'INTERNAL_ERROR',
      correlationId,
    });
  }
}

module.exports = {
  recalculateContributions,
  requireCoordinatorRole,
};
