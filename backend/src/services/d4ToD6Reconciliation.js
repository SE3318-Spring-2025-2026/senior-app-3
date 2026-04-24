/**
 * ============================================================================
 * Issue #237: D4 → D6 Reconciliation Service (Flow 139 Implementation)
 * ============================================================================
 *
 * CHANGES FOR ISSUE #237:
 * - Implements reconciliation logic between D4 reporting records and D6 canonical data
 * - Verifies D4 reporting metrics match D6 contribution records
 * - Prevents duplicate canonical rows during D4→D6 sync (idempotent design)
 * - DFD Flow 139 (f7_d4_d6): Ensures consistency between reporting and canonical stores
 * - Can be run as periodic job or triggered after persistence operation
 * - Logs reconciliation outcomes for audit trail
 *
 * OPERATIONAL MODEL:
 * D4 is the reporting/visibility layer (coordinator dashboards)
 * D6 is the canonical/truth layer (student contributions)
 * This service ensures D4 stays in sync with D6 without creating duplicates.
 *
 * DFD INTEGRATION:
 * Input: D4 (SprintReportingRecord), D6 (SprintContributionRecord)
 * Output: Reconciliation status + audit trail
 * Flow: f7_d4_d6 (D4 → D6 consistency check)
 */

const SprintReportingRecord = require('../models/SprintReportingRecord');
const SprintContributionRecord = require('../models/SprintContributionRecord');
const { createAuditLog } = require('./auditService');
const { v4: uuidv4 } = require('uuid');

/**
 * ISSUE #237: Custom error class for reconciliation errors
 */
class ReconciliationError extends Error {
  constructor(status = 500, code = 'RECONCILIATION_ERROR', message) {
    super(message);
    this.name = 'ReconciliationError';
    this.status = status;
    this.code = code;
    this.timestamp = new Date();
  }
}

/**
 * ISSUE #237: Main reconciliation orchestrator
 *
 * Reconciles D4 reporting records with D6 canonical contribution data.
 * Verifies that:
 * 1. D4 aggregate metrics match D6 detail records
 * 2. No duplicate canonical rows were created
 * 3. Counts and totals are consistent
 *
 * Called either:
 * - Periodically (cron job) to verify overall consistency
 * - After persistence operation to confirm write succeeded
 * - On-demand by administrators
 *
 * @param {string} sprintId - Sprint identifier
 * @param {string} groupId - Group identifier
 * @param {object} options - Configuration options
 *   - autoRepair: {boolean} Attempt to fix inconsistencies (default: false)
 *   - verbose: {boolean} Detailed logging (default: false)
 * @returns {object} ReconciliationResult with status and details
 * @throws {ReconciliationError} On critical failures
 */
async function reconcileSprintRecords(sprintId, groupId, options = {}) {
  const correlationId = `recon_${uuidv4().split('-')[0]}_${Date.now()}`;
  const reconciliationLog = {
    correlationId,
    sprintId,
    groupId,
    startedAt: new Date(),
    steps: [],
    inconsistencies: [],
    repairs: [],
  };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: FETCH D4 REPORTING RECORD
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 1,
      name: 'fetch_d4_reporting',
      startedAt: new Date(),
    });

    const d4Report = await SprintReportingRecord.findForSprint(sprintId, groupId);

    if (!d4Report) {
      // ISSUE #237: No D4 reporting record — this is OK (D4 writes are optional)
      reconciliationLog.steps[0].completedAt = new Date();
      reconciliationLog.steps[0].status = 'not_found';
      reconciliationLog.steps[0].message = 'No D4 reporting record found (optional)';

      return {
        success: true,
        correlationId,
        sprintId,
        groupId,
        status: 'no_d4_record',
        message: 'No D4 reporting record to reconcile',
        reconciliationLog,
      };
    }

    reconciliationLog.steps[0].completedAt = new Date();
    reconciliationLog.steps[0].status = 'found';
    reconciliationLog.steps[0].d4RecordId = d4Report._id;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: FETCH ALL D6 CONTRIBUTION RECORDS FOR THIS SPRINT
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 2,
      name: 'fetch_d6_contributions',
      startedAt: new Date(),
    });

    const d6Records = await SprintContributionRecord.getSprintContributions(
      sprintId,
      groupId
    );

    reconciliationLog.steps[1].completedAt = new Date();
    reconciliationLog.steps[1].status = 'success';
    reconciliationLog.steps[1].recordCount = d6Records.length;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: VALIDATE MEMBER COUNT CONSISTENCY
    // ISSUE #237: D4.totalMembers should match number of D6 records
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 3,
      name: 'validate_member_count',
      startedAt: new Date(),
    });

    const d4MemberCount = d4Report.totalMembers;
    const d6MemberCount = d6Records.length;

    if (d4MemberCount !== d6MemberCount) {
      const inconsistency = {
        field: 'totalMembers',
        d4Value: d4MemberCount,
        d6Value: d6MemberCount,
        discrepancy: Math.abs(d4MemberCount - d6MemberCount),
        severity: 'high',
      };

      reconciliationLog.inconsistencies.push(inconsistency);

      if (options.autoRepair) {
        // ISSUE #237: Auto-repair: update D4 to match D6
        d4Report.totalMembers = d6MemberCount;
        reconciliationLog.repairs.push({
          field: 'totalMembers',
          action: 'updated_to_d6_value',
          newValue: d6MemberCount,
        });
      }
    }

    reconciliationLog.steps[2].completedAt = new Date();
    reconciliationLog.steps[2].memberCountMatch = d4MemberCount === d6MemberCount;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: VALIDATE AGGREGATED METRICS
    // ISSUE #237: Recalculate metrics from D6 and compare with D4
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 4,
      name: 'validate_aggregates',
      startedAt: new Date(),
    });

    if (d6Records.length > 0) {
      // Calculate metrics from D6 records
      const calculatedMetrics = calculateAggregateMetrics(d6Records);

      // Validate each metric
      const metricValidations = validateMetrics(d4Report, calculatedMetrics);

      if (metricValidations.inconsistencies.length > 0) {
        reconciliationLog.inconsistencies.push(...metricValidations.inconsistencies);

        if (options.autoRepair) {
          // ISSUE #237: Auto-repair: update D4 metrics to match D6
          d4Report.averageRatio = calculatedMetrics.averageRatio;
          d4Report.maxRatio = calculatedMetrics.maxRatio;
          d4Report.minRatio = calculatedMetrics.minRatio;
          d4Report.groupTotalStoryPoints = calculatedMetrics.groupTotalStoryPoints;

          reconciliationLog.repairs.push({
            field: 'aggregateMetrics',
            action: 'recalculated_from_d6',
            metrics: calculatedMetrics,
          });
        }
      }

      reconciliationLog.steps[3].completedAt = new Date();
      reconciliationLog.steps[3].status = 'validated';
      reconciliationLog.steps[3].metrics = calculatedMetrics;
    } else {
      reconciliationLog.steps[3].completedAt = new Date();
      reconciliationLog.steps[3].status = 'skipped';
      reconciliationLog.steps[3].reason = 'no_d6_records';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: CHECK FOR DUPLICATE CANONICAL ROWS
    // ISSUE #237: Verify no duplicate (sprintId, studentId, groupId) tuples
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 5,
      name: 'check_duplicate_rows',
      startedAt: new Date(),
    });

    // Count records by (sprintId, studentId, groupId) to find duplicates
    const duplicateCheck = await SprintContributionRecord.collection.aggregate([
      {
        $match: {
          sprintId,
          groupId,
        },
      },
      {
        $group: {
          _id: {
            sprintId: '$sprintId',
            studentId: '$studentId',
            groupId: '$groupId',
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]).toArray();

    if (duplicateCheck.length > 0) {
      const duplicateInconsistency = {
        field: 'duplicate_records',
        duplicateGroupCount: duplicateCheck.length,
        severity: 'critical',
        duplicates: duplicateCheck,
      };

      reconciliationLog.inconsistencies.push(duplicateInconsistency);

      // ISSUE #237: Duplicates should never happen with idempotent key design
      // If found, this indicates a serious data integrity issue
      console.error(
        `[D4D6Reconciliation] CRITICAL: Found duplicate canonical rows [correlationId: ${correlationId}]`,
        duplicateCheck
      );
    }

    reconciliationLog.steps[4].completedAt = new Date();
    reconciliationLog.steps[4].duplicatesFound = duplicateCheck.length > 0;
    reconciliationLog.steps[4].duplicateCount = duplicateCheck.length;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: UPDATE RECONCILIATION METADATA IN D4
    // ISSUE #237: Record reconciliation result and timestamp
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 6,
      name: 'update_d4_metadata',
      startedAt: new Date(),
    });

    try {
      // ISSUE #237: Update D4 record with reconciliation status
      d4Report.lastReconciledAt = new Date();
      d4Report.d6RecordCount = d6Records.length;
      d4Report.reconciliationStatus =
        reconciliationLog.inconsistencies.length === 0 ? 'consistent' : 'inconsistent';

      await d4Report.save();

      reconciliationLog.steps[5].completedAt = new Date();
      reconciliationLog.steps[5].status = 'updated';
      reconciliationLog.steps[5].newStatus = d4Report.reconciliationStatus;
    } catch (err) {
      console.error(
        `[D4D6Reconciliation] Failed to update D4 metadata: ${err.message} [correlationId: ${correlationId}]`
      );
      reconciliationLog.steps[5].status = 'warning';
      reconciliationLog.steps[5].warning = err.message;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: AUDIT LOGGING
    // ISSUE #237: Track reconciliation operation for compliance
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.steps.push({
      step: 7,
      name: 'audit_logging',
      startedAt: new Date(),
    });

    try {
      await createAuditLog({
        action: 'D4_D6_RECONCILIATION_COMPLETED',
        targetId: `${sprintId}#${groupId}`,
        groupId,
        payload: {
          sprintId,
          groupId,
          correlationId,
          status: d4Report.reconciliationStatus,
          inconsistencyCount: reconciliationLog.inconsistencies.length,
          repairsApplied: reconciliationLog.repairs.length,
          d6RecordCount,
        },
      });

      reconciliationLog.steps[6].completedAt = new Date();
      reconciliationLog.steps[6].status = 'success';
    } catch (auditErr) {
      console.warn(
        `[D4D6Reconciliation] Audit log failed (non-fatal): ${auditErr.message} [correlationId: ${correlationId}]`
      );
      reconciliationLog.steps[6].status = 'warning';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RETURN SUCCESS RESPONSE
    // ─────────────────────────────────────────────────────────────────────────
    reconciliationLog.completedAt = new Date();
    reconciliationLog.durationMs = reconciliationLog.completedAt - reconciliationLog.startedAt;

    return {
      success: true,
      correlationId,
      sprintId,
      groupId,
      status: reconciliationLog.inconsistencies.length === 0 ? 'consistent' : 'inconsistent',
      inconsistencyCount: reconciliationLog.inconsistencies.length,
      repairsApplied: reconciliationLog.repairs.length,
      d6RecordCount,
      durationMs: reconciliationLog.durationMs,
      reconciliationLog,
    };
  } catch (err) {
    reconciliationLog.completedAt = new Date();
    reconciliationLog.failed = true;

    if (err instanceof ReconciliationError) {
      console.error(
        `[D4D6Reconciliation] Operation failed [${err.code}]: ${err.message} [correlationId: ${correlationId}]`
      );
      throw err;
    }

    console.error(
      `[D4D6Reconciliation] Unexpected error: ${err.message} [correlationId: ${correlationId}]`,
      reconciliationLog
    );

    throw new ReconciliationError(
      500,
      'UNEXPECTED_ERROR',
      `Reconciliation failed: ${err.message}`
    );
  }
}

/**
 * ISSUE #237: Calculate aggregate metrics from D6 records
 *
 * @param {Array} d6Records - Array of SprintContributionRecord documents
 * @returns {object} Calculated metrics (averageRatio, maxRatio, minRatio, groupTotalStoryPoints)
 */
function calculateAggregateMetrics(d6Records) {
  if (!d6Records || d6Records.length === 0) {
    return {
      averageRatio: 0,
      maxRatio: 0,
      minRatio: 0,
      groupTotalStoryPoints: 0,
    };
  }

  const ratios = d6Records.map((r) => r.contributionRatio);
  const totalStoryPoints = d6Records.reduce((sum, r) => sum + (r.completedStoryPoints || 0), 0);

  return {
    averageRatio: ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0,
    maxRatio: Math.max(...ratios),
    minRatio: Math.min(...ratios),
    groupTotalStoryPoints: totalStoryPoints,
  };
}

/**
 * ISSUE #237: Validate D4 metrics against calculated D6 metrics
 *
 * @param {object} d4Report - D4 SprintReportingRecord
 * @param {object} calculatedMetrics - Metrics calculated from D6
 * @returns {object} Validation result with inconsistencies list
 */
function validateMetrics(d4Report, calculatedMetrics) {
  const inconsistencies = [];
  const tolerance = 0.01; // ISSUE #237: Allow 1% floating-point tolerance

  // Compare averageRatio
  if (Math.abs(d4Report.averageRatio - calculatedMetrics.averageRatio) > tolerance) {
    inconsistencies.push({
      field: 'averageRatio',
      d4Value: d4Report.averageRatio,
      d6Value: calculatedMetrics.averageRatio,
      discrepancy: Math.abs(d4Report.averageRatio - calculatedMetrics.averageRatio),
      severity: 'medium',
    });
  }

  // Compare maxRatio
  if (Math.abs(d4Report.maxRatio - calculatedMetrics.maxRatio) > tolerance) {
    inconsistencies.push({
      field: 'maxRatio',
      d4Value: d4Report.maxRatio,
      d6Value: calculatedMetrics.maxRatio,
      discrepancy: Math.abs(d4Report.maxRatio - calculatedMetrics.maxRatio),
      severity: 'medium',
    });
  }

  // Compare minRatio
  if (Math.abs(d4Report.minRatio - calculatedMetrics.minRatio) > tolerance) {
    inconsistencies.push({
      field: 'minRatio',
      d4Value: d4Report.minRatio,
      d6Value: calculatedMetrics.minRatio,
      discrepancy: Math.abs(d4Report.minRatio - calculatedMetrics.minRatio),
      severity: 'medium',
    });
  }

  // Compare groupTotalStoryPoints
  if (
    Math.abs(d4Report.groupTotalStoryPoints - calculatedMetrics.groupTotalStoryPoints) > 0.1
  ) {
    inconsistencies.push({
      field: 'groupTotalStoryPoints',
      d4Value: d4Report.groupTotalStoryPoints,
      d6Value: calculatedMetrics.groupTotalStoryPoints,
      discrepancy: Math.abs(
        d4Report.groupTotalStoryPoints - calculatedMetrics.groupTotalStoryPoints
      ),
      severity: 'high',
    });
  }

  return { inconsistencies };
}

/**
 * ISSUE #237: Batch reconciliation for all sprints needing verification
 *
 * Used as periodic job to scan all D4 records and verify consistency.
 * Finds records that haven't been reconciled in > 24 hours.
 *
 * @param {object} options - Job configuration
 * @returns {object} Batch reconciliation results
 */
async function reconcilePendingRecords(options = {}) {
  try {
    // ISSUE #237: Find records that need reconciliation
    const pendingRecords = await SprintReportingRecord.findNeedingReconciliation();

    const batchLog = {
      startedAt: new Date(),
      totalPending: pendingRecords.length,
      results: [],
    };

    // ISSUE #237: Process each pending record
    for (const record of pendingRecords) {
      try {
        const result = await reconcileSprintRecords(record.sprintId, record.groupId, options);
        batchLog.results.push({
          sprintId: record.sprintId,
          groupId: record.groupId,
          status: result.status,
          inconsistencies: result.inconsistencyCount,
        });
      } catch (err) {
        batchLog.results.push({
          sprintId: record.sprintId,
          groupId: record.groupId,
          status: 'error',
          error: err.message,
        });
      }
    }

    batchLog.completedAt = new Date();
    batchLog.durationMs = batchLog.completedAt - batchLog.startedAt;

    return batchLog;
  } catch (err) {
    console.error(`[D4D6Reconciliation] Batch reconciliation failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  reconcileSprintRecords,
  reconcilePendingRecords,
  calculateAggregateMetrics,
  validateMetrics,
  ReconciliationError,
};
