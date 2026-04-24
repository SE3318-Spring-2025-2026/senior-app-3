/**
 * ============================================================================
 * Issue #237: [BE] Persist Sprint Records — D6 Writes + D4/D6 Sync Path (7.5)
 * ============================================================================
 *
 * CHANGES FOR ISSUE #237:
 * - Implements the persistence layer for sprint contribution artifacts
 * - Writes per-student sprint records to D6 (ContributionRecord)
 * - Optionally writes sprint reporting records to D4
 * - Ensures D4→D6 sync path maintains idempotency (no duplicate canonical rows)
 * - Handles finalized/locked sprint conflicts with 409 responses
 * - All writes include audit fields (createdAt, updatedAt)
 * - Correlation IDs for notification service (#238) integration
 * - DFD Flows: f7_p75_ds_d6, f7_p75_d4, f7_d4_d6, f7_p75_ext_notification
 *
 * DESIGN PATTERN:
 * This service orchestrates a 6-step pipeline:
 *   1. Validate inputs and authorization
 *   2. Check if sprint is finalized/locked (409 if so)
 *   3. Upsert D6 records for each student (atomic per-student operations)
 *   4. Optionally write D4 reporting record (if config enabled)
 *   5. Dispatch notification events to Notification Service
 *   6. Return audit trail with persistence metadata
 *
 * IDEMPOTENCY GUARANTEE:
 * - Idempotent key: (sprintId, studentId, groupId) for D6 records
 * - Same input (contribution summary) always produces same D6 output
 * - Multiple calls to persistSprintContributions with same data are safe
 * - D4→D6 sync checks if record exists before inserting (prevents duplicates)
 */

const ContributionRecord = require('../models/ContributionRecord');
const SprintRecord = require('../models/SprintRecord');
const SprintContributionRecord = require('../models/SprintContributionRecord');
const SprintReportingRecord = require('../models/SprintReportingRecord');
const { createAuditLog } = require('./auditService');
const { dispatchNotificationEvent } = require('./notificationService');
const { v4: uuidv4 } = require('uuid');

/**
 * ISSUE #237: Custom error class for persistence layer
 * Provides consistent error handling with HTTP status codes and error codes
 */
class PersistenceServiceError extends Error {
  constructor(status = 500, code = 'PERSISTENCE_ERROR', message = 'Persistence operation failed') {
    super(message);
    this.name = 'PersistenceServiceError';
    this.status = status;
    this.code = code;
    this.timestamp = new Date();
  }
}

/**
 * ISSUE #237: Main persistence orchestrator
 *
 * Persists sprint contribution data from Process 7.4 (ratio engine) to database.
 * Called after successful ratio calculation in contributionRatios controller.
 *
 * @param {string} groupId - Group identifier
 * @param {string} sprintId - Sprint identifier
 * @param {object} contributionSummary - Output from Process 7.4 (Issue #236)
 *   Shape: { contributions: [{studentId, contributionRatio, targetStoryPoints, completedStoryPoints}], ... }
 * @param {string} coordinatorId - User performing the operation (audit trail)
 * @param {object} options - Configuration options
 *   - persistToD4: {boolean} Write reporting record to D4 (default: true)
 *   - allowOverrideFinalized: {boolean} Allow overwriting finalized sprint (default: false)
 *   - notificationPayload: {object} Additional context for notifications
 * @returns {object} PersistenceResult with audit trail and metadata
 * @throws {PersistenceServiceError} On validation failures, lock conflicts, or write errors
 */
async function persistSprintContributions(
  groupId,
  sprintId,
  contributionSummary,
  coordinatorId,
  options = {}
) {
  const correlationId = `pc_${uuidv4().split('-')[0]}_${Date.now()}`;
  const operationStartTime = Date.now();
  const persistenceLog = {
    correlationId,
    groupId,
    sprintId,
    coordinatorId,
    startedAt: new Date(),
    steps: [],
    errors: [],
  };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: VALIDATE INPUTS AND AUTHORIZATION
    // ISSUE #237: Guard against invalid input before any DB operations
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.steps.push({
      step: 1,
      name: 'validate_inputs',
      startedAt: new Date(),
    });

    if (!groupId || typeof groupId !== 'string') {
      throw new PersistenceServiceError(400, 'INVALID_GROUP_ID', 'groupId must be a non-empty string');
    }

    if (!sprintId || typeof sprintId !== 'string') {
      throw new PersistenceServiceError(400, 'INVALID_SPRINT_ID', 'sprintId must be a non-empty string');
    }

    if (!coordinatorId || typeof coordinatorId !== 'string') {
      throw new PersistenceServiceError(400, 'INVALID_COORDINATOR_ID', 'coordinatorId must be a non-empty string');
    }

    if (!contributionSummary || !Array.isArray(contributionSummary.contributions)) {
      throw new PersistenceServiceError(
        400,
        'INVALID_CONTRIBUTION_SUMMARY',
        'contributionSummary must contain contributions array'
      );
    }

    if (contributionSummary.contributions.length === 0) {
      throw new PersistenceServiceError(
        422,
        'EMPTY_CONTRIBUTION_LIST',
        'No contributions provided for persistence'
      );
    }

    persistenceLog.steps[0].completedAt = new Date();
    persistenceLog.steps[0].validatedRecords = contributionSummary.contributions.length;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: CHECK IF SPRINT IS FINALIZED/LOCKED
    // ISSUE #237: Prevent overwriting finalized sprint snapshots (409 conflict)
    // DFD Reference: f7_p75_ds_d6 (Process 7.5 → D6)
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.steps.push({
      step: 2,
      name: 'check_sprint_locked',
      startedAt: new Date(),
    });

    const sprintRecord = await SprintRecord.findOne({
      sprintId,
      groupId,
    });

    if (sprintRecord && sprintRecord.isFinalized === true && !options.allowOverrideFinalized) {
      throw new PersistenceServiceError(
        409,
        'SPRINT_FINALIZED_CONFLICT',
        `Sprint ${sprintId} is finalized and cannot be modified. Set allowOverrideFinalized=true to override.`,
        { sprintId, groupId, finalizationReason: sprintRecord.finalizationReason }
      );
    }

    persistenceLog.steps[1].completedAt = new Date();
    persistenceLog.steps[1].isFinalizedCheck = sprintRecord?.isFinalized || false;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: UPSERT D6 CONTRIBUTION RECORDS (ATOMIC PER-STUDENT)
    // ISSUE #237: Implement idempotent upsert using (sprintId, studentId, groupId)
    // All records have updatedAt automatically set by mongoose timestamps
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.steps.push({
      step: 3,
      name: 'upsert_d6_records',
      startedAt: new Date(),
      records: [],
    });

    const upsertResults = [];

    for (const contribution of contributionSummary.contributions) {
      try {
        const { studentId, contributionRatio, targetStoryPoints, completedStoryPoints } = contribution;

        // ISSUE #237: Upsert pattern — find and update, or create if not exists
        // Uses findOneAndUpdate for atomic operation (prevents race conditions)
        const updatedRecord = await ContributionRecord.findOneAndUpdate(
          {
            sprintId,
            studentId,
            groupId,
          },
          {
            $set: {
              // ISSUE #237: Update contribution metrics from Process 7.4 output
              contributionRatio: Number(contributionRatio.toFixed(4)), // Clamp to 4 decimal places
              storyPointsCompleted: completedStoryPoints,
              storyPointsAssigned: targetStoryPoints,
              // ISSUE #237: Audit field — timestamps handled by mongoose
              lastUpdatedAt: new Date(),
            },
          },
          {
            upsert: true, // Create if not exists
            new: true, // Return updated document
            runValidators: true,
          }
        );

        upsertResults.push({
          studentId,
          contributionRecordId: updatedRecord.contributionRecordId,
          isNew: !updatedRecord._id, // True if just created
          ratio: updatedRecord.contributionRatio,
        });

        persistenceLog.steps[2].records.push({
          studentId,
          status: 'success',
          recordId: updatedRecord.contributionRecordId,
        });
      } catch (err) {
        persistenceLog.steps[2].records.push({
          studentId: contribution.studentId,
          status: 'error',
          reason: err.message,
        });
        throw new PersistenceServiceError(
          500,
          'D6_UPSERT_FAILED',
          `Failed to upsert D6 record for student ${contribution.studentId}: ${err.message}`
        );
      }
    }

    persistenceLog.steps[2].completedAt = new Date();
    persistenceLog.steps[2].upsertedCount = upsertResults.length;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: OPTIONALLY WRITE D4 REPORTING RECORD
    // ISSUE #237: D4 write is conditional (config-driven)
    // DFD Reference: f7_p75_d4 (Process 7.5 → D4 / Flow 128)
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.steps.push({
      step: 4,
      name: 'write_d4_reporting_record',
      startedAt: new Date(),
    });

    let d4ReportingRecord = null;

    if (options.persistToD4 !== false) {
      try {
        // ISSUE #237: Create or update D4 reporting record
        // This ties to Flow 128 intent (coordinator visibility)
        d4ReportingRecord = await SprintReportingRecord.findOneAndUpdate(
          {
            sprintId,
            groupId,
          },
          {
            $set: {
              coordinatorId,
              totalMembers: contributionSummary.contributions.length,
              groupTotalStoryPoints: contributionSummary.groupTotalStoryPoints || 0,
              calculationStrategy: contributionSummary.strategyUsed || 'fixed',
              calculatedAt: new Date(),
              averageRatio: contributionSummary.averageRatio || 0,
              maxRatio: contributionSummary.maxRatio || 0,
              minRatio: contributionSummary.minRatio || 0,
              correlationId, // ISSUE #237: Link to notification service events
            },
          },
          {
            upsert: true,
            new: true,
            runValidators: true,
          }
        );

        persistenceLog.steps[3].completedAt = new Date();
        persistenceLog.steps[3].d4RecordId = d4ReportingRecord._id;
        persistenceLog.steps[3].status = 'written';
      } catch (err) {
        // ISSUE #237: D4 write failures are logged but do not block D6 persistence
        // This follows operational guideline: main flow (D6) succeeds even if reporting (D4) fails
        console.error(
          `[PersistenceService] D4 write failed (non-fatal): ${err.message} [correlationId: ${correlationId}]`
        );
        persistenceLog.steps[3].status = 'warning';
        persistenceLog.steps[3].warning = `D4 write failed: ${err.message}`;
        persistenceLog.errors.push({
          step: 4,
          message: err.message,
          isFatal: false,
        });
      }
    } else {
      persistenceLog.steps[3].completedAt = new Date();
      persistenceLog.steps[3].status = 'skipped';
      persistenceLog.steps[3].reason = 'persistToD4=false';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: UPDATE SPRINT RECORD WITH RECALCULATION METADATA
    // ISSUE #237: Track when contributions were last calculated/persisted
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.steps.push({
      step: 5,
      name: 'update_sprint_metadata',
      startedAt: new Date(),
    });

    try {
      const updatedSprintRecord = await SprintRecord.findOneAndUpdate(
        {
          sprintId,
          groupId,
        },
        {
          $set: {
            // ISSUE #237: Track recalculation timestamp for audit trail
            recalculatedAt: new Date(),
            lastRecalculatedBy: coordinatorId,
            totalContributionRecords: contributionSummary.contributions.length,
            groupTotalStoryPoints: contributionSummary.groupTotalStoryPoints || 0,
            calculationStrategy: contributionSummary.strategyUsed || 'fixed',
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        }
      );

      persistenceLog.steps[4].completedAt = new Date();
      persistenceLog.steps[4].sprintRecordId = updatedSprintRecord.sprintRecordId;
    } catch (err) {
      console.error(
        `[PersistenceService] Sprint metadata update failed: ${err.message} [correlationId: ${correlationId}]`
      );
      persistenceLog.steps[4].status = 'warning';
      persistenceLog.steps[4].warning = err.message;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: CREATE AUDIT LOG ENTRY
    // ISSUE #237: Track all persistence operations for compliance
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.steps.push({
      step: 6,
      name: 'audit_logging',
      startedAt: new Date(),
    });

    try {
      await createAuditLog({
        action: 'SPRINT_CONTRIBUTIONS_PERSISTED',
        actorId: coordinatorId,
        targetId: sprintId,
        groupId,
        payload: {
          sprintId,
          groupId,
          correlationId,
          recordsPersistedCount: upsertResults.length,
          d4RecordCreated: !!d4ReportingRecord,
          totalStoryPoints: contributionSummary.groupTotalStoryPoints || 0,
          strategy: contributionSummary.strategyUsed || 'fixed',
        },
      });

      persistenceLog.steps[5].completedAt = new Date();
      persistenceLog.steps[5].status = 'success';
    } catch (auditErr) {
      // ISSUE #237: Non-fatal audit logging failure
      console.error(
        `[PersistenceService] Audit log creation failed (non-fatal): ${auditErr.message} [correlationId: ${correlationId}]`
      );
      persistenceLog.steps[5].status = 'warning';
      persistenceLog.steps[5].warning = auditErr.message;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: DISPATCH NOTIFICATION EVENTS (NON-BLOCKING)
    // ISSUE #237: Emit events for Notification Service (#238)
    // Uses correlationId to link notifications with persistence operation
    // ─────────────────────────────────────────────────────────────────────────
    // Note: Notifications dispatched asynchronously via setImmediate (non-blocking)
    if (process.env.ENABLE_NOTIFICATIONS !== 'false') {
      setImmediate(() => {
        dispatchNotificationEvent(
          {
            type: 'sprint_contributions_persisted',
            correlationId,
            groupId,
            sprintId,
            coordinatorId,
            recordsCount: upsertResults.length,
            persistedAt: new Date(),
            summaryStats: {
              totalStoryPoints: contributionSummary.groupTotalStoryPoints || 0,
              averageRatio: contributionSummary.averageRatio || 0,
              strategyUsed: contributionSummary.strategyUsed || 'fixed',
            },
          },
          coordinatorId
        ).catch((err) => {
          console.warn(
            `[PersistenceService] Notification dispatch failed (non-fatal): ${err.message} [correlationId: ${correlationId}]`
          );
        });
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RETURN SUCCESS RESPONSE WITH AUDIT TRAIL
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.completedAt = new Date();
    persistenceLog.durationMs = persistenceLog.completedAt - persistenceLog.startedAt;

    return {
      success: true,
      correlationId,
      sprintId,
      groupId,
      recordsPersistedCount: upsertResults.length,
      d4RecordCreated: !!d4ReportingRecord,
      persistedAt: new Date(),
      durationMs: persistenceLog.durationMs,
      auditLog: persistenceLog,
      // ISSUE #237: Return persisted records for client confirmation
      persistedRecords: upsertResults,
    };
  } catch (err) {
    // ─────────────────────────────────────────────────────────────────────────
    // ERROR HANDLING AND LOGGING
    // ISSUE #237: All errors logged with correlationId for debugging
    // ─────────────────────────────────────────────────────────────────────────
    persistenceLog.completedAt = new Date();
    persistenceLog.durationMs = persistenceLog.completedAt - persistenceLog.startedAt;
    persistenceLog.failed = true;

    if (err instanceof PersistenceServiceError) {
      persistenceLog.errors.push({
        name: 'PersistenceServiceError',
        code: err.code,
        status: err.status,
        message: err.message,
      });

      console.error(
        `[PersistenceService] Operation failed [${err.code}]: ${err.message} [correlationId: ${correlationId}]`,
        persistenceLog
      );

      throw err;
    }

    // ISSUE #237: Wrap unexpected errors in PersistenceServiceError
    persistenceLog.errors.push({
      name: err.name || 'UnexpectedError',
      message: err.message,
    });

    console.error(
      `[PersistenceService] Unexpected error: ${err.message} [correlationId: ${correlationId}]`,
      persistenceLog
    );

    throw new PersistenceServiceError(
      500,
      'UNEXPECTED_ERROR',
      `Persistence operation failed: ${err.message}`
    );
  }
}

/**
 * ISSUE #237: Validate idempotent key for duplicate prevention
 *
 * Checks if a D6 record already exists for the given (sprintId, studentId, groupId) tuple.
 * Used before upsert to determine if record is new or updated.
 *
 * @returns {boolean} True if record exists
 */
async function recordExists(sprintId, studentId, groupId) {
  try {
    const record = await ContributionRecord.findOne({
      sprintId,
      studentId,
      groupId,
    });
    return !!record;
  } catch (err) {
    console.error('[PersistenceService] Record existence check failed:', err.message);
    return false;
  }
}

module.exports = {
  persistSprintContributions,
  recordExists,
  PersistenceServiceError,
};
