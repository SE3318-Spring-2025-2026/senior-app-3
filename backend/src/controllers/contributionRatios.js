/**
 * ============================================================================
 * Issue #237: Contribution Ratios Controller — Process 7.4 + 7.5 Integration
 * ============================================================================
 *
 * CHANGES FOR ISSUE #237:
 * - Integrates persistence layer into contributions recalculation endpoint
 * - After successful ratio calculation (Process 7.4), persists data to D6/D4 (Process 7.5)
 * - Calls persistSprintContributions() with full contribution summary
 * - Handles 409 conflicts for finalized/locked sprints
 * - Adds persistedAt timestamp to response
 * - Emits notification events to Notification Service (#238)
 * - Audit logging for compliance
 *
 * ENDPOINT:
 * POST /api/groups/:groupId/sprints/:sprintId/contributions/recalculate
 *
 * PROCESS FLOW (7.4 + 7.5):
 * 1. Input validation
 * 2. Authorization checks (coordinator role)
 * 3. Call ratio engine (Process 7.4 from Issue #236)
 * 4. [NEW] Persist results to D6/D4 (Process 7.5 from Issue #237) ← YOU ARE HERE
 * 5. Emit notifications
 * 6. Return detailed summary response
 *
 * DFD INTEGRATION:
 * Input: f7_p73_p74, f7_p74_p75
 * Output: f7_p75_ds_d6, f7_p75_d4, f7_p75_ext_notification
 */

const { recalculateSprintRatios } = require('../services/contributionRatioService');
const { persistSprintContributions } = require('../services/sprintContributionPersistence');
const { reconcileSprintRecords } = require('../services/d4ToD6Reconciliation');
const { createAuditLog } = require('../services/auditService');
const { validateCoordinatorRole } = require('../middleware/roleMiddleware');

/**
 * ISSUE #237: POST /api/groups/:groupId/sprints/:sprintId/contributions/recalculate
 *
 * Recalculates contribution ratios and persists them to database.
 * Main public-facing endpoint for Process 7.4 + 7.5.
 *
 * Request body:
 * {
 *   notifyStudents: boolean (optional, default: false),
 *   overrideFinalized: boolean (optional, default: false),
 *   persistToD4: boolean (optional, default: true),
 *   notes: string (optional)
 * }
 *
 * Response on success (200):
 * {
 *   success: true,
 *   sprintId,
 *   groupId,
 *   ratiosCalculated: true,
 *   persistenceResult: {
 *     success: true,
 *     recordsPersistedCount,
 *     persistedAt,
 *     durationMs
 *   },
 *   reconciliationResult: (optional if D4 enabled),
 *   contributionSummary: {
 *     contributions: [...],
 *     groupTotalStoryPoints,
 *     averageRatio,
 *     ...
 *   }
 * }
 *
 * Response on conflict (409):
 * {
 *   code: 'SPRINT_FINALIZED_CONFLICT',
 *   message: '...',
 *   details: { finalizationReason, ... }
 * }
 */
async function recalculateContributions(req, res) {
  const { groupId, sprintId } = req.params;
  const { notifyStudents = false, overrideFinalized = false, persistToD4 = true, notes = null } =
    req.body;
  const coordinatorId = req.user.userId;
  const requesterRole = req.user.role;
  let operationLog = {
    startedAt: new Date(),
    steps: [],
    groupId,
    sprintId,
    coordinatorId,
  };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: AUTHORIZATION CHECK
    // ISSUE #237: Only coordinators can trigger recalculation
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.steps.push({ step: 1, name: 'authorization_check', startedAt: new Date() });

    if (requesterRole !== 'coordinator') {
      operationLog.steps[0].status = 'failed';
      return res.status(403).json({
        code: 'UNAUTHORIZED_ROLE',
        message: 'Only coordinators can trigger contribution recalculation',
        requiredRole: 'coordinator',
        currentRole: requesterRole,
      });
    }

    operationLog.steps[0].status = 'success';
    operationLog.steps[0].completedAt = new Date();

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: INPUT VALIDATION
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.steps.push({
      step: 2,
      name: 'input_validation',
      startedAt: new Date(),
    });

    if (!groupId || !sprintId) {
      operationLog.steps[1].status = 'failed';
      return res.status(400).json({
        code: 'MISSING_PARAMETERS',
        message: 'groupId and sprintId are required',
      });
    }

    operationLog.steps[1].status = 'success';
    operationLog.steps[1].completedAt = new Date();

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: CALL PROCESS 7.4 (RATIO CALCULATION ENGINE)
    // Issue #236: recalculateSprintRatios from contributionRatioService
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.steps.push({
      step: 3,
      name: 'ratio_calculation_process_7_4',
      startedAt: new Date(),
      service: 'contributionRatioService',
    });

    const ratioResult = await recalculateSprintRatios(
      groupId,
      sprintId,
      coordinatorId,
      { notifyStudents }
    );

    operationLog.steps[2].status = 'success';
    operationLog.steps[2].completedAt = new Date();
    operationLog.steps[2].ratioResultSummary = {
      contributionCount: ratioResult.contributions?.length || 0,
      groupTotal: ratioResult.groupTotalStoryPoints,
      strategy: ratioResult.strategyUsed,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: PERSIST TO D6/D4 (PROCESS 7.5 - ISSUE #237 IMPLEMENTATION)
    // ISSUE #237: Call persistence service to write contribution records
    // Handles 409 conflicts if sprint is finalized
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.steps.push({
      step: 4,
      name: 'persist_sprint_contributions_process_7_5',
      startedAt: new Date(),
      service: 'sprintContributionPersistence',
    });

    let persistenceResult;
    try {
      persistenceResult = await persistSprintContributions(
        groupId,
        sprintId,
        ratioResult, // ISSUE #237: Use Process 7.4 output as input to Process 7.5
        coordinatorId,
        {
          persistToD4,
          allowOverrideFinalized: overrideFinalized,
          notificationPayload: {
            notifyStudents,
            coordinatorNotes: notes,
          },
        }
      );

      operationLog.steps[3].status = 'success';
      operationLog.steps[3].completedAt = new Date();
      operationLog.steps[3].persistenceSummary = {
        recordsPersistedCount: persistenceResult.recordsPersistedCount,
        d4RecordCreated: persistenceResult.d4RecordCreated,
        durationMs: persistenceResult.durationMs,
      };
    } catch (persistErr) {
      // ISSUE #237: Handle persistence errors with appropriate HTTP status
      operationLog.steps[3].status = 'failed';
      operationLog.steps[3].error = persistErr.message;

      if (persistErr.code === 'SPRINT_FINALIZED_CONFLICT') {
        // 409 Conflict: Sprint is locked
        return res.status(409).json({
          code: persistErr.code,
          message: persistErr.message,
          details: {
            sprintId,
            groupId,
            finalized: true,
          },
        });
      }

      if (persistErr.status === 422) {
        // 422 Unprocessable Entity: Validation failure
        return res.status(422).json({
          code: persistErr.code,
          message: persistErr.message,
        });
      }

      // Other errors → 500
      throw persistErr;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: OPTIONAL D4→D6 RECONCILIATION
    // ISSUE #237: Verify consistency between D4 reporting and D6 canonical data
    // Non-fatal: failures don't block the response
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.steps.push({
      step: 5,
      name: 'd4_d6_reconciliation_flow_139',
      startedAt: new Date(),
      service: 'd4ToD6Reconciliation',
    });

    let reconciliationResult = null;
    if (persistToD4 && persistenceResult.d4RecordCreated) {
      try {
        reconciliationResult = await reconcileSprintRecords(groupId, sprintId, {
          autoRepair: false, // ISSUE #237: Don't auto-repair during normal operation
          verbose: false,
        });

        operationLog.steps[4].status = 'success';
        operationLog.steps[4].completedAt = new Date();
        operationLog.steps[4].reconciliationStatus = reconciliationResult.status;
        operationLog.steps[4].inconsistencyCount = reconciliationResult.inconsistencyCount;
      } catch (reconErr) {
        // ISSUE #237: Reconciliation failures are logged but non-fatal
        console.warn(
          `[contributionRatios] D4→D6 reconciliation warning: ${reconErr.message}`
        );
        operationLog.steps[4].status = 'warning';
        operationLog.steps[4].warning = reconErr.message;
      }
    } else {
      operationLog.steps[4].status = 'skipped';
      operationLog.steps[4].reason = persistToD4 ? 'no_d4_record' : 'persistToD4=false';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: AUDIT LOGGING
    // ISSUE #237: Track this operation for compliance
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.steps.push({
      step: 6,
      name: 'audit_logging',
      startedAt: new Date(),
    });

    try {
      await createAuditLog({
        action: 'CONTRIBUTIONS_RECALCULATED_AND_PERSISTED',
        actorId: coordinatorId,
        targetId: sprintId,
        groupId,
        payload: {
          sprintId,
          groupId,
          coordinatorId,
          ratiosCalculated: ratioResult.contributions?.length || 0,
          recordsPersisted: persistenceResult.recordsPersistedCount,
          d4RecordCreated: persistenceResult.d4RecordCreated,
          reconciliationStatus: reconciliationResult?.status || 'skipped',
          notifyStudents,
          persistedAt: persistenceResult.persistedAt,
        },
      });

      operationLog.steps[5].status = 'success';
      operationLog.steps[5].completedAt = new Date();
    } catch (auditErr) {
      // ISSUE #237: Non-fatal audit failure
      console.warn(`[contributionRatios] Audit logging failed: ${auditErr.message}`);
      operationLog.steps[5].status = 'warning';
      operationLog.steps[5].warning = auditErr.message;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUCCESS RESPONSE
    // ─────────────────────────────────────────────────────────────────────────
    operationLog.completedAt = new Date();
    operationLog.durationMs = operationLog.completedAt - operationLog.startedAt;

    // ISSUE #237: Return comprehensive response with all details
    return res.status(200).json({
      success: true,
      sprintId,
      groupId,
      coordinatorId,

      // ISSUE #237: Process 7.4 results (ratio calculation)
      ratiosCalculated: true,
      contributionCount: ratioResult.contributions?.length || 0,

      // ISSUE #237: Process 7.5 results (persistence)
      persistenceResult: {
        success: persistenceResult.success,
        recordsPersistedCount: persistenceResult.recordsPersistedCount,
        d4RecordCreated: persistenceResult.d4RecordCreated,
        persistedAt: persistenceResult.persistedAt,
        durationMs: persistenceResult.durationMs,
      },

      // ISSUE #237: D4→D6 reconciliation results (if applicable)
      reconciliationResult: reconciliationResult
        ? {
            status: reconciliationResult.status,
            inconsistencyCount: reconciliationResult.inconsistencyCount,
            repairsApplied: reconciliationResult.repairsApplied,
          }
        : null,

      // ISSUE #237: Include full contribution summary for client confirmation
      contributionSummary: {
        contributions: ratioResult.contributions,
        groupTotalStoryPoints: ratioResult.groupTotalStoryPoints,
        averageRatio: ratioResult.averageRatio,
        maxRatio: ratioResult.maxRatio,
        minRatio: ratioResult.minRatio,
        strategyUsed: ratioResult.strategyUsed,
        recalculatedAt: ratioResult.recalculatedAt,
      },
    });
  } catch (error) {
    operationLog.completedAt = new Date();
    operationLog.failed = true;

    console.error(
      '[contributionRatios] Unexpected error during contribution recalculation:',
      error
    );

    // ISSUE #237: Return appropriate error response
    if (error.status === 403) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: error.message,
      });
    }

    if (error.status === 404) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: error.message,
      });
    }

    if (error.status === 409) {
      return res.status(409).json({
        code: error.code || 'CONFLICT',
        message: error.message,
      });
    }

    if (error.status === 422) {
      return res.status(422).json({
        code: error.code || 'UNPROCESSABLE_ENTITY',
        message: error.message,
      });
    }

    // Default to 500 Internal Server Error
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during contribution recalculation',
      error: error.message,
    });
  }
}

module.exports = {
  recalculateContributions,
};
