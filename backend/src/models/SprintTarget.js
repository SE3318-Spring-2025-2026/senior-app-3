/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ISSUE #236 MODEL: SprintTarget.js
 * MongoDB Schema for D8 (Process 7.4 Configuration)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * Stores per-student contribution targets and strategy configuration for each sprint.
 * This is part of Data Store 8 (D8) in DFD Level 2.7 architecture.
 *
 * D8 Role in Process 7.4:
 * - Input to Process 7.4 via flow f7_ds_d8_p74
 * - Provides targetStoryPoints for each student
 * - Provides ratioStrategy configuration (fixed, weighted, normalized)
 * - Enables customizable grading policies per sprint
 *
 * Business Logic:
 * Each sprint may have different targets per student OR per group.
 * Example:
 *   Sprint 1: Each student targets 13 SP
 *   Sprint 2: Group targets 50 SP total (to be distributed)
 *   Sprint 3: Targets weighted by role (lead = 15, contributor = 10)
 *
 * Relationship to D6 (ContributionRecord):
 * - SprintTarget: Configuration (set by professor/coordinator BEFORE sprint)
 * - ContributionRecord: Runtime data (populated DURING sprint)
 * - Process 7.4: Joins these to calculate ratio = completed / target
 *
 * Relationship to D2 (GroupMembership):
 * - SprintTarget references students via groupId + studentId
 * - Ensures targets only for approved group members
 *
 * Acceptance Criteria References:
 * - Criterion #2: Zero targets handled gracefully (this model may be empty/missing)
 * - Criterion #4: Per-student breakdown supported (model structure enables this)
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * ISSUE #236 SCHEMA: SprintTargetSchema
 * Stores target configuration for ratio calculation in Process 7.4
 *
 * Field Breakdown:
 *
 * @field {ObjectId} sprintTargetId
 *   ISSUE #236: Unique identifier for this target configuration
 *   Why: Primary key for lookups and relationships
 *   Generated: Auto-created on save via _id
 *
 * @field {ObjectId} sprintId
 *   ISSUE #236: Reference to Sprint (from SprintRecord)
 *   Why: Links this target to specific sprint (composite key with groupId)
 *   Indexed: Yes (with groupId as compound index)
 *   Constraint: Required, non-null
 *
 * @field {ObjectId} groupId
 *   ISSUE #236: Reference to Group (student group in this sprint)
 *   Why: Scope targets to specific group (different groups may have different targets)
 *   Indexed: Yes (with sprintId as compound index)
 *   Constraint: Required, non-null
 *
 * @field {ObjectId} studentId
 *   ISSUE #236: Reference to User (student this target applies to)
 *   Why: Enables per-student targets
 *   Design: Can be null for GROUP-LEVEL targets (future)
 *   Indexed: Yes (for fast lookup of student's target)
 *
 * @field {Number} targetStoryPoints
 *   ISSUE #236: Target story points for this student (Acceptance Criterion #2)
 *   Why: Denominator for ratio = completed / target
 *   Range: > 0 (must be positive)
 *   Default: 13 (typical default for 2-week sprints)
 *   Constraint: Required, must be > 0
 *   Note: If null/0, Process 7.4 uses fallback (average target or assigned)
 *
 * @field {String} ratioStrategy
 *   ISSUE #236: Strategy for computing ratio (Design Point #1)
 *   Why: Different grading scenarios require different strategies
 *   Enum: 'fixed' | 'weighted' | 'normalized'
 *   Semantics:
 *   - 'fixed': ratio = completed / target (independent per student)
 *   - 'weighted': ratio = completed / groupTotal (proportional within group)
 *   - 'normalized': all ratios sum to 1.0 (zero-sum grading)
 *   Default: 'fixed'
 *   Constraint: Required, must be one of enum values
 *
 * @field {Number} rubricWeight
 *   ISSUE #236: Optional weight for this student (future feature)
 *   Why: Some students might count differently (e.g., team lead = 1.5x)
 *   Range: 0.5 to 2.0 (50% to 200% of normal weight)
 *   Default: 1.0 (equal weight)
 *   Constraint: Optional, defaults to 1.0
 *   Note: Not yet used in Process 7.4, reserved for future
 *
 * @field {ObjectId} createdBy
 *   ISSUE #236: User who created/set this target (audit trail)
 *   Why: Know who configured targets (typically professor/coordinator)
 *   Indexed: No (not commonly searched)
 *   Constraint: Required, must be valid user ID
 *
 * @field {String} notes
 *   ISSUE #236: Optional notes/justification for target
 *   Why: Document why this target was set (compliance/audit)
 *   Example: "Extra target for recovering student", "Adjusted for skill level"
 *   Constraint: Optional, max 500 chars
 *   Default: Empty string
 *
 * @field {Date} createdAt
 *   ISSUE #236: Timestamp when target was created
 *   Why: Audit trail, chronological sorting
 *   Default: Current date/time
 *   Immutable: After creation (helps with audits)
 *
 * @field {Date} updatedAt
 *   ISSUE #236: Timestamp when target was last modified
 *   Why: Know if targets were adjusted during sprint
 *   Default: Current date/time
 *   Mutable: Updated on save
 *
 * @field {Date} deletedAt
 *   ISSUE #236: Soft delete timestamp (not currently used)
 *   Why: Preserve audit trail even if target deleted
 *   Design: Queries should exclude soft-deleted records
 *   Default: null (not deleted)
 */
const SprintTargetSchema = new Schema(
  {
    // ISSUE #236: Primary Identifiers
    // Why: Uniquely identify this target record
    sprintTargetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
      unique: true,
      index: true,
      description: '[ISSUE #236] Unique target configuration ID'
    },

    // ISSUE #236: Foreign Keys (Composite Key)
    // Why: Link to sprint and group context
    sprintId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'sprintId is required for target configuration'],
      index: true,
      description: '[ISSUE #236] Reference to Sprint (D6 SprintRecord)'
    },

    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'groupId is required for target configuration'],
      index: true,
      description: '[ISSUE #236] Reference to Group (student group in sprint)'
    },

    // ISSUE #236: Student Identity
    // Why: Enable per-student targets
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'studentId is required for per-student targets'],
      index: true,
      description: '[ISSUE #236] Reference to Student/User'
    },

    // ISSUE #236: Core Target Value (Acceptance Criterion #2)
    // Why: Denominator for ratio calculation in Process 7.4
    // Safety: Must be > 0 to avoid division by zero
    targetStoryPoints: {
      type: Number,
      required: [true, 'targetStoryPoints is required'],
      min: [1, 'targetStoryPoints must be positive (min: 1)'],
      max: [999, 'targetStoryPoints must not exceed 999'],
      default: 13,
      description: '[ISSUE #236] Target story points (denominator for ratio = completed / target)',
      validate: {
        validator: function (v) {
          return Number.isFinite(v) && v > 0;
        },
        message: 'targetStoryPoints must be a positive finite number'
      }
    },

    // ISSUE #236: Ratio Calculation Strategy (Design Point #1)
    // Why: Different grading scenarios need different strategies
    ratioStrategy: {
      type: String,
      enum: {
        values: ['fixed', 'weighted', 'normalized'],
        message: 'ratioStrategy must be "fixed", "weighted", or "normalized"'
      },
      default: 'fixed',
      description: '[ISSUE #236] Strategy for ratio calculation: fixed (completed/target), weighted (completed/groupTotal), normalized (sum=1.0)'
    },

    // ISSUE #236: Weight for This Student (Future Feature)
    // Why: Support weighted grading (some students count more)
    rubricWeight: {
      type: Number,
      min: [0.5, 'rubricWeight must be at least 0.5 (50%)'],
      max: [2.0, 'rubricWeight must not exceed 2.0 (200%)'],
      default: 1.0,
      description: '[ISSUE #236] Optional weight multiplier (future use: 0.5-2.0 range)'
    },

    // ISSUE #236: Audit Trail
    // Why: Know who set these targets (compliance)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'createdBy (user who created target) is required'],
      index: true,
      description: '[ISSUE #236] User who created/configured this target (professor/coordinator)'
    },

    // ISSUE #236: Optional Notes
    // Why: Document rationale for target (e.g., "extra support needed")
    notes: {
      type: String,
      maxlength: [500, 'notes must not exceed 500 characters'],
      default: '',
      description: '[ISSUE #236] Optional notes/justification for this target'
    },

    // ISSUE #236: Soft Delete Flag (Future Use)
    // Why: Preserve audit trail even if target deleted
    deletedAt: {
      type: Date,
      default: null,
      index: true,
      description: '[ISSUE #236] Soft delete timestamp (null = active, set = deleted)'
    }
  },
  {
    // ISSUE #236: Mongoose Schema Options
    // Why: Enable auto-timestamps and better metadata
    timestamps: true,  // Creates createdAt, updatedAt automatically
    collection: 'SprintTargets',
    strict: 'throw'    // Reject unknown fields on save
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #236: INDEXES
// Optimize query patterns for Process 7.4
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ISSUE #236: Compound Index (sprintId, groupId)
 * Why: Fast lookup of all targets for a sprint in a group
 * Query: SprintTarget.find({sprintId, groupId})
 * Used By: Process 7.4 STEP 4 (load targets)
 */
SprintTargetSchema.index(
  { sprintId: 1, groupId: 1 },
  {
    name: 'idx_sprint_group_targets',
    background: true
  }
);

/**
 * ISSUE #236: Compound Index (sprintId, studentId)
 * Why: Fast lookup of specific student's target in sprint
 * Query: SprintTarget.findOne({sprintId, studentId})
 * Used By: Process 7.4 STEP 6 (get target for student)
 */
SprintTargetSchema.index(
  { sprintId: 1, studentId: 1 },
  {
    name: 'idx_sprint_student_target',
    background: true
  }
);

/**
 * ISSUE #236: Compound Index (groupId, studentId)
 * Why: Find all targets for student across sprints in group
 * Query: SprintTarget.find({groupId, studentId})
 * Use Case: Audit trail, consistency checking
 */
SprintTargetSchema.index(
  { groupId: 1, studentId: 1 },
  {
    name: 'idx_group_student_targets',
    background: true
  }
);

/**
 * ISSUE #236: Index on createdBy
 * Why: Audit queries - find all targets created by a user
 * Query: SprintTarget.find({createdBy})
 * Use Case: Track what each professor configured
 */
SprintTargetSchema.index(
  { createdBy: 1 },
  {
    name: 'idx_targets_by_creator',
    background: true
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #236: VALIDATION & HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ISSUE #236: Pre-save hook - Validate composite key uniqueness
 * Why: Ensure only one target per (sprint, group, student) tuple
 * What: Check database before saving
 * Error: Throws 11000 duplicate key error if exists
 * Design: MongoDB unique index handles this, hook for clarity
 */
SprintTargetSchema.pre('save', async function (next) {
  // ISSUE #236: Check for duplicate target
  // Why: Only one target allowed per (sprint, student, group)
  // What: Query for existing record with same composite key
  if (this.isNew) {
    const existing = await mongoose.model('SprintTarget').findOne({
      sprintId: this.sprintId,
      groupId: this.groupId,
      studentId: this.studentId,
      _id: { $ne: this._id }  // Exclude self if updating
    });

    if (existing) {
      throw new Error(
        `[ISSUE #236] Duplicate target: Sprint ${this.sprintId} already has target for student ${this.studentId} in group ${this.groupId}`
      );
    }
  }

  next();
});

/**
 * ISSUE #236: Post-save hook - Log creation
 * Why: Audit trail for who created targets
 * What: Log to console + optional audit service
 */
SprintTargetSchema.post('save', function (doc) {
  // ISSUE #236: Audit log for target creation/update
  console.info('[SprintTarget] Target saved', {
    sprintTargetId: doc.sprintTargetId,
    sprintId: doc.sprintId,
    groupId: doc.groupId,
    studentId: doc.studentId,
    targetStoryPoints: doc.targetStoryPoints,
    strategy: doc.ratioStrategy,
    createdBy: doc.createdBy,
    isNew: this.isNew,
    timestamp: new Date()
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #236: METHODS & STATICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ISSUE #236: Static Method - Get all targets for sprint
 * Used By: Process 7.4 STEP 4
 */
SprintTargetSchema.statics.getSprintTargets = async function (sprintId, groupId) {
  // ISSUE #236: Fetch all targets for sprint
  // Why: Used in Process 7.4 STEP 4-5 to build targets map
  return this.find({
    sprintId: sprintId,
    groupId: groupId,
    deletedAt: null  // Exclude soft-deleted
  });
};

/**
 * ISSUE #236: Static Method - Get target for specific student
 * Used By: Process 7.4 STEP 6
 */
SprintTargetSchema.statics.getStudentTarget = async function (sprintId, studentId, groupId) {
  // ISSUE #236: Fetch single student's target
  // Why: Used in Process 7.4 STEP 6 for ratio calculation
  return this.findOne({
    sprintId: sprintId,
    studentId: studentId,
    groupId: groupId,
    deletedAt: null
  });
};

/**
 * ISSUE #236: Instance Method - Validate target value
 * Returns: boolean true if valid, false otherwise
 */
SprintTargetSchema.methods.isValid = function () {
  // ISSUE #236: Validate this target record
  // Why: Quick validation without re-querying DB
  return (
    this.targetStoryPoints > 0 &&
    Number.isFinite(this.targetStoryPoints) &&
    ['fixed', 'weighted', 'normalized'].includes(this.ratioStrategy)
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ISSUE #236: Export SprintTarget Model
 * Used By:
 * - contributionRatioService.js (Process 7.4 STEP 4)
 * - sprintTargetService.js (D8 query helper)
 * - Tests (test fixtures)
 */
module.exports = mongoose.model('SprintTarget', SprintTargetSchema, 'SprintTargets');
