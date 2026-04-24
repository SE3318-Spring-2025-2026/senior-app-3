/**
 * ============================================================================
 * Issue #237: SprintReportingRecord Model (D4 Data Store Extension)
 * ============================================================================
 *
 * CHANGES FOR ISSUE #237:
 * - NEW model for optional D4 reporting extension to support coordinator dashboards
 * - Stores aggregated sprint contribution metrics for reporting/visibility
 * - Lightweight metadata: total members, group totals, calculation strategy, timestamp
 * - Links to D6 records via (sprintId, groupId) composite key
 * - Supports D4→D6 reconciliation (Flow 139) for consistency checks
 * - Can be enabled/disabled via persistToD4 configuration flag
 *
 * DATABASE MAPPING:
 * Collection: sprintreportingrecords (D4 scope)
 * Indexes: (sprintId, groupId) for efficient lookup
 *
 * DFD INTEGRATION:
 * Input: Process 7.5 (Issue #237) completion
 * Output: D4 reporting metadata for coordinator visibility (Flow 128)
 * Sync: D4→D6 reconciliation ensures canonical metrics remain consistent (Flow 139)
 *
 * OPERATIONAL NOTE:
 * D4 write failures do NOT block D6 persistence (non-fatal operation).
 * This allows the main flow (contribution persistence) to succeed even if
 * reporting infrastructure fails.
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const sprintReportingRecordSchema = new mongoose.Schema(
  {
    // ISSUE #237: Unique identifier for this reporting record
    sprintReportingId: {
      type: String,
      default: () => `srr_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
      index: true,
    },

    // ISSUE #237: Foreign keys for linkage to D6 canonical data
    sprintId: {
      type: String,
      required: true,
      index: true,
      // ISSUE #237: Composite key component for D4→D6 sync (Flow 139)
      description: 'Sprint identifier (matches D6 sprintId)',
    },

    groupId: {
      type: String,
      required: true,
      index: true,
      // ISSUE #237: Composite key component for group-scoped reporting
      description: 'Group identifier (matches D6 groupId)',
    },

    // ISSUE #237: Composite unique index ensures one reporting record per sprint+group
    // Created in migration: { sprintId: 1, groupId: 1 } unique: true
    _uniqueKey: {
      type: String,
      unique: true,
      index: true,
      // ISSUE #237: Generated before save via pre-hook
    },

    // ─────────────────────────────────────────────────────────────────────────
    // COORDINATOR/ACTOR INFORMATION
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Coordinator who triggered the calculation
    coordinatorId: {
      type: String,
      required: true,
      index: true,
      // ISSUE #237: Audit trail — who performed the persistence operation
      description: 'Coordinator ID who initiated sprint contribution persistence',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // AGGREGATED SPRINT METRICS (Read-Only from D6)
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Total number of group members with contributions
    totalMembers: {
      type: Number,
      required: true,
      min: 0,
      // ISSUE #237: Snapshot of group size at calculation time
      description: 'Total group members with contribution records',
    },

    // ISSUE #237: Sum of all students' completed story points
    groupTotalStoryPoints: {
      type: Number,
      required: true,
      min: 0,
      // ISSUE #237: Sum of completedStoryPoints across all group members
      description: 'Total completed story points for group (all members)',
    },

    // ISSUE #237: Average contribution ratio across group
    averageRatio: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // ISSUE #237: Mean of all contributionRatio values
      description: 'Average contribution ratio for group',
    },

    // ISSUE #237: Maximum contribution ratio in group
    maxRatio: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // ISSUE #237: Highest individual ratio
      description: 'Maximum contribution ratio (best performer)',
    },

    // ISSUE #237: Minimum contribution ratio in group
    minRatio: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // ISSUE #237: Lowest individual ratio
      description: 'Minimum contribution ratio (lowest performer)',
    },

    // ISSUE #237: Calculation strategy used
    calculationStrategy: {
      type: String,
      enum: ['fixed', 'weighted', 'normalized'],
      default: 'fixed',
      // ISSUE #237: Documents which ratio normalization was applied
      description: 'Which strategy was used to calculate ratios',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TIMESTAMP METADATA
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: When the sprint contributions were calculated
    calculatedAt: {
      type: Date,
      required: true,
      // ISSUE #237: Tracks when D6 persistence occurred
      description: 'Timestamp of contribution calculation',
    },

    // ISSUE #237: When D4 reporting record was last updated
    // Note: updatedAt is automatic via mongoose timestamps
    // ISSUE #237: Used to detect stale reporting data in D4→D6 sync

    // ─────────────────────────────────────────────────────────────────────────
    // D4 → D6 RECONCILIATION FIELDS
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Correlation ID linking to persistence operation
    correlationId: {
      type: String,
      default: null,
      // ISSUE #237: Same ID as in sprintContributionPersistence
      // Used to trace D4→D6 sync operations (Flow 139)
      description: 'Correlation ID from persistence operation',
    },

    // ISSUE #237: Last time D4→D6 reconciliation was performed
    lastReconciledAt: {
      type: Date,
      default: null,
      // ISSUE #237: Tracks when sync verification last succeeded
      description: 'When D4→D6 reconciliation last completed',
    },

    // ISSUE #237: Number of D6 records found during last reconciliation
    d6RecordCount: {
      type: Number,
      default: null,
      // ISSUE #237: Sanity check: should match totalMembers
      // If different, indicates data inconsistency
      description: 'Count of D6 records during last reconciliation',
    },

    // ISSUE #237: Status of D4→D6 sync
    reconciliationStatus: {
      type: String,
      enum: ['consistent', 'inconsistent', 'unverified', 'in-progress'],
      default: 'unverified',
      // ISSUE #237: 'consistent' = D4 matches D6, 'inconsistent' = mismatch detected
      description: 'Result of D4→D6 reconciliation check',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CONFIGURATION & FEATURE FLAGS
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Whether student notifications were sent
    studentNotificationsSent: {
      type: Boolean,
      default: false,
      // ISSUE #237: Tracks if Issue #238 notifications were dispatched
      description: 'Whether student notifications were sent',
    },

    // ISSUE #237: Optional notes for coordinator
    coordinatorNotes: {
      type: String,
      maxlength: 500,
      default: null,
      // ISSUE #237: Free-form field for operational context
      description: 'Optional notes/context for coordinator',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SOFT DELETE SUPPORT (for audit trail)
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Soft delete timestamp
    deletedAt: {
      type: Date,
      default: null,
      // ISSUE #237: Null = active, populated = soft deleted
      description: 'When this record was deleted (null = active)',
    },

    // createdAt, updatedAt: Automatic via mongoose timestamps
    // ISSUE #237: These fields track record lifecycle for audit
  },
  {
    timestamps: true, // ISSUE #237: Adds createdAt, updatedAt automatically
    collection: 'sprintreportingrecords',
  }
);

// ISSUE #237: INDEXES FOR EFFICIENT QUERYING

// Index 1: Primary lookup by sprint + group
// DFD Use: Fetch reporting record for D4→D6 reconciliation (Flow 139)
sprintReportingRecordSchema.index(
  { sprintId: 1, groupId: 1 },
  { unique: true, sparse: true }
);

// Index 2: Coordinator's reporting records
// DFD Use: Query records created by specific coordinator
sprintReportingRecordSchema.index(
  { coordinatorId: 1, calculatedAt: -1 },
  { background: true }
);

// Index 3: Reconciliation status queries
// DFD Use: Find records needing reconciliation verification
sprintReportingRecordSchema.index(
  { reconciliationStatus: 1, lastReconciledAt: 1 },
  { background: true }
);

// Index 4: Active records (not soft-deleted)
// DFD Use: Filter out deleted records in queries
sprintReportingRecordSchema.index(
  { groupId: 1, deletedAt: 1 },
  { background: true }
);

// ISSUE #237: PRE-SAVE HOOK — Generate composite key
sprintReportingRecordSchema.pre('save', function (next) {
  // ISSUE #237: Create composite key for idempotency
  if (this.isModified('sprintId') || this.isModified('groupId')) {
    this._uniqueKey = `${this.sprintId}#${this.groupId}`;
  }

  next();
});

// ISSUE #237: QUERY HELPER — Find active records
sprintReportingRecordSchema.query.active = function () {
  return this.where({ deletedAt: null });
};

// ISSUE #237: INSTANCE METHOD — Check if record needs reconciliation
sprintReportingRecordSchema.methods.needsReconciliation = function () {
  // Records need reconciliation if:
  // 1. Never reconciled, OR
  // 2. Last reconciliation was > 24 hours ago
  if (!this.lastReconciledAt) return true;

  const hoursSinceReconciliation =
    (Date.now() - this.lastReconciledAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceReconciliation > 24;
};

// ISSUE #237: INSTANCE METHOD — Mark as soft-deleted
sprintReportingRecordSchema.methods.softDelete = function () {
  // ISSUE #237: Preserve historical data while removing from queries
  this.deletedAt = new Date();
  return this.save();
};

// ISSUE #237: STATIC METHOD — Find reporting record for sprint
sprintReportingRecordSchema.statics.findForSprint = async function (sprintId, groupId) {
  return this.findOne({
    sprintId,
    groupId,
    deletedAt: null,
  });
};

// ISSUE #237: STATIC METHOD — Find records needing reconciliation
sprintReportingRecordSchema.statics.findNeedingReconciliation = async function () {
  const oneDay = 24 * 60 * 60 * 1000;
  const yesterday = new Date(Date.now() - oneDay);

  return this.find({
    deletedAt: null,
    $or: [
      { lastReconciledAt: null }, // Never reconciled
      { lastReconciledAt: { $lt: yesterday } }, // Older than 24 hours
    ],
  });
};

// ISSUE #237: STATIC METHOD — Find by coordinator
sprintReportingRecordSchema.statics.findByCoordinator = async function (coordinatorId) {
  return this.find({
    coordinatorId,
    deletedAt: null,
  })
    .sort({ calculatedAt: -1 })
    .exec();
};

// ISSUE #237: INSTANCE METHOD — Validate consistency with D6
// This is called by D4→D6 reconciliation job (Flow 139)
sprintReportingRecordSchema.methods.validate = function () {
  const errors = [];

  if (!this.sprintId) errors.push('sprintId is required');
  if (!this.groupId) errors.push('groupId is required');
  if (this.totalMembers < 0) errors.push('totalMembers cannot be negative');
  if (this.groupTotalStoryPoints < 0) errors.push('groupTotalStoryPoints cannot be negative');
  if (this.averageRatio < 0 || this.averageRatio > 1) {
    errors.push('averageRatio must be between 0 and 1');
  }
  if (this.maxRatio < 0 || this.maxRatio > 1) {
    errors.push('maxRatio must be between 0 and 1');
  }
  if (this.minRatio < 0 || this.minRatio > 1) {
    errors.push('minRatio must be between 0 and 1');
  }
  if (this.minRatio > this.maxRatio) {
    errors.push('minRatio cannot be greater than maxRatio');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// ISSUE #237: Export model
const SprintReportingRecord = mongoose.model(
  'SprintReportingRecord',
  sprintReportingRecordSchema
);

module.exports = SprintReportingRecord;
