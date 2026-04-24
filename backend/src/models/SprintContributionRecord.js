/**
 * ============================================================================
 * Issue #237: SprintContributionRecord Model (D6 Data Store Extension)
 * ============================================================================
 *
 * CHANGES FOR ISSUE #237:
 * - NEW model to extend D6 capabilities for Process 7.5 persistence
 * - Stores per-student sprint contribution snapshots after recalculation
 * - Provides idempotent write pattern with (sprintId, studentId, groupId) key
 * - Includes finalization lock to prevent overwriting completed sprint records
 * - Audit fields: createdAt, updatedAt (automatic via mongoose)
 * - Supports D4→D6 reconciliation (Flow 139)
 *
 * DATABASE MAPPING:
 * Collection: sprintcontributionrecords (D6 scope)
 * Indexes: Compound (sprintId, studentId, groupId) for efficient lookup
 *
 * DFD INTEGRATION:
 * Input: Process 7.4 output (Issue #236)
 * Output: Canonical contribution snapshot stored in D6
 * Sync: D4→D6 flow references this model for idempotency checks
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const sprintContributionRecordSchema = new mongoose.Schema(
  {
    // ISSUE #237: Unique identifier for this contribution record
    sprintContributionId: {
      type: String,
      default: () => `scr_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
      index: true,
    },

    // ISSUE #237: Foreign key to Sprint
    sprintId: {
      type: String,
      required: true,
      index: true,
      // ISSUE #237: Matches Process 7.4 input (f7_p73_p74)
      description: 'Sprint identifier from Process 7.1/7.2 sync',
    },

    // ISSUE #237: Foreign key to Student
    studentId: {
      type: String,
      required: true,
      index: true,
      // ISSUE #237: Each student gets exactly one record per sprint
      description: 'Student identifier for whom this record tracks contribution',
    },

    // ISSUE #237: Foreign key to Group
    groupId: {
      type: String,
      required: true,
      index: true,
      // ISSUE #237: Scopes contribution to group context
      description: 'Group identifier for authorization and reporting',
    },

    // ISSUE #237: Idempotent composite key
    // This ensures (sprintId, studentId, groupId) tuple is unique
    // Compound index created in migration for efficient lookup
    _uniqueKey: {
      type: String,
      unique: true,
      index: true,
      // ISSUE #237: Generated before save() via pre-hook
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CONTRIBUTION METRICS (from Process 7.3 + 7.4)
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Target story points assigned to this student (from D8)
    targetStoryPoints: {
      type: Number,
      required: true,
      min: 0,
      max: 999,
      description: 'Target story points assigned to student for this sprint',
    },

    // ISSUE #237: Completed story points (from Issue #235 attribution)
    completedStoryPoints: {
      type: Number,
      required: true,
      min: 0,
      max: 999,
      description: 'Story points completed (merged PRs) for this sprint',
    },

    // ISSUE #237: Calculated ratio (from Process 7.4)
    contributionRatio: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // ISSUE #237: Clamped to [0,1] range per Issue #236 specs
      description: 'Per-student contribution ratio (0-1 range)',
    },

    // ISSUE #237: Strategy used for ratio calculation
    ratioStrategy: {
      type: String,
      enum: ['fixed', 'weighted', 'normalized'],
      default: 'fixed',
      // ISSUE #237: Documents which normalization strategy was applied
      description: 'Which ratio calculation strategy was used',
    },

    // ISSUE #237: Percentage of group total
    percentageOfGroupTotal: {
      type: Number,
      min: 0,
      max: 100,
      description: 'This student\'s percentage of group total story points',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // FINALIZATION & LOCK FIELDS
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Prevents overwriting locked sprint snapshots (409 conflict)
    isFinalized: {
      type: Boolean,
      default: false,
      // ISSUE #237: When true, this record cannot be modified
      description: 'If true, record is locked and cannot be updated',
    },

    // ISSUE #237: Reason for finalization (audit trail)
    finalizationReason: {
      type: String,
      enum: [
        'SPRINT_WINDOW_CLOSED',
        'COMMITTEE_REVIEW_STARTED',
        'MANUAL_LOCK',
        'GRADE_SUBMITTED',
      ],
      default: null,
      // ISSUE #237: Documents why sprint is finalized
      description: 'Reason why this record was finalized/locked',
    },

    // ISSUE #237: Timestamp when finalized
    finalizedAt: {
      type: Date,
      default: null,
      description: 'When this record was finalized/locked',
    },

    // ISSUE #237: Who finalized this record
    finalizedBy: {
      type: String,
      default: null,
      description: 'Coordinator/admin who finalized this record',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // D4 → D6 RECONCILIATION SUPPORT
    // ─────────────────────────────────────────────────────────────────────────

    // ISSUE #237: Links to D4 reporting record (Flow 139)
    d4ReportingRecordId: {
      type: String,
      default: null,
      // ISSUE #237: Reference to SprintReportingRecord for sync reconciliation
      description: 'ID of associated D4 SprintReportingRecord (if created)',
    },

    // ISSUE #237: Correlation ID from persistence operation
    correlationId: {
      type: String,
      default: null,
      // ISSUE #237: Ties this record to notification events (Issue #238)
      description: 'Correlation ID from sprintContributionPersistence operation',
    },

    // ISSUE #237: Last operation metadata
    lastCalculationAt: {
      type: Date,
      default: null,
      description: 'When this student\'s ratio was last calculated',
    },

    lastCalculatedBy: {
      type: String,
      default: null,
      description: 'Coordinator who triggered the last calculation',
    },

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIT FIELDS (handled by mongoose timestamps)
    // ─────────────────────────────────────────────────────────────────────────
    // createdAt: Date (automatic)
    // updatedAt: Date (automatic)
    // ISSUE #237: These ensure all writes include audit trail
  },
  {
    timestamps: true, // ISSUE #237: Adds createdAt, updatedAt automatically
    collection: 'sprintcontributionrecords',
  }
);

// ISSUE #237: COMPOUND INDEXES FOR EFFICIENT QUERIES

// Index 1: Lookup by sprint + student + group (idempotent key)
// DFD Use: Quick check before upsert in Process 7.5
sprintContributionRecordSchema.index(
  { sprintId: 1, studentId: 1, groupId: 1 },
  { unique: true, sparse: true }
);

// Index 2: Lookup all contributions for a sprint
// DFD Use: Fetch all students for D4→D6 reconciliation
sprintContributionRecordSchema.index(
  { sprintId: 1, groupId: 1 },
  { background: true }
);

// Index 3: Finalized sprints query
// DFD Use: Filter locked sprints when checking 409 conflicts
sprintContributionRecordSchema.index(
  { sprintId: 1, isFinalized: 1 },
  { background: true }
);

// Index 4: Coordinator queries by actor
// DFD Use: Audit trail queries by who last updated
sprintContributionRecordSchema.index(
  { lastCalculatedBy: 1, lastCalculationAt: 1 },
  { background: true }
);

// ISSUE #237: PRE-SAVE HOOK — Generate idempotent key
sprintContributionRecordSchema.pre('save', function (next) {
  // ISSUE #237: Create unique composite key for idempotency
  if (this.isModified('sprintId') || this.isModified('studentId') || this.isModified('groupId')) {
    this._uniqueKey = `${this.sprintId}#${this.studentId}#${this.groupId}`;
  }

  // ISSUE #237: Validate finalization constraints
  if (this.isFinalized === true && !this.finalizedAt) {
    this.finalizedAt = new Date();
  }

  next();
});

// ISSUE #237: PRE-UPDATE HOOK — Check finalization lock
sprintContributionRecordSchema.pre('findOneAndUpdate', function (next) {
  // ISSUE #237: Prevent updates to finalized records
  const update = this.getUpdate();
  if (update.$set && this._conditions.isFinalized === true) {
    // Allow finalization timestamp changes, but block other modifications
    const restrictedFields = Object.keys(update.$set).filter(
      (key) => !['finalizedAt', 'd4ReportingRecordId'].includes(key)
    );

    if (restrictedFields.length > 0) {
      const err = new Error(
        `Cannot update finalized sprint contribution record. Restricted fields: ${restrictedFields.join(', ')}`
      );
      err.status = 409;
      err.code = 'RECORD_FINALIZED';
      return next(err);
    }
  }

  next();
});

// ISSUE #237: INSTANCE METHOD — Check if record is valid
sprintContributionRecordSchema.methods.isValid = function () {
  return (
    this.sprintId &&
    this.studentId &&
    this.groupId &&
    this.targetStoryPoints !== undefined &&
    this.completedStoryPoints !== undefined &&
    this.contributionRatio !== undefined &&
    this.contributionRatio >= 0 &&
    this.contributionRatio <= 1
  );
};

// ISSUE #237: INSTANCE METHOD — Get ratio as percentage
sprintContributionRecordSchema.methods.getRatioPercentage = function () {
  return Math.round(this.contributionRatio * 100);
};

// ISSUE #237: STATIC METHOD — Fetch all contributions for a sprint
sprintContributionRecordSchema.statics.getSprintContributions = async function (
  sprintId,
  groupId
) {
  return this.find(
    {
      sprintId,
      groupId,
      isFinalized: { $ne: true },
    },
    {
      studentId: 1,
      contributionRatio: 1,
      targetStoryPoints: 1,
      completedStoryPoints: 1,
      percentageOfGroupTotal: 1,
    }
  )
    .sort({ contributionRatio: -1 })
    .exec();
};

// ISSUE #237: STATIC METHOD — Get specific student's record
sprintContributionRecordSchema.statics.getStudentContribution = async function (
  sprintId,
  studentId,
  groupId
) {
  return this.findOne({
    sprintId,
    studentId,
    groupId,
  });
};

// ISSUE #237: STATIC METHOD — Check if sprint is fully finalized
sprintContributionRecordSchema.statics.isSprintFinalized = async function (
  sprintId,
  groupId
) {
  const record = await this.findOne(
    {
      sprintId,
      groupId,
      isFinalized: true,
    },
    { _id: 1 }
  );
  return !!record;
};

// ISSUE #237: Custom error class for validation
class SprintContributionValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'SprintContributionValidationError';
    this.field = field;
  }
}

// ISSUE #237: Export model
const SprintContributionRecord = mongoose.model(
  'SprintContributionRecord',
  sprintContributionRecordSchema
);

module.exports = SprintContributionRecord;
