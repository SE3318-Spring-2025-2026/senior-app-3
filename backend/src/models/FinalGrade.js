/**
 * ================================================================================
 * ISSUE #253: FinalGrade Model — Approval Persistence & Override Tracking
 * ================================================================================
 *
 * Purpose:
 * Persist final grades for a group+student pair with approval state, manual
 * overrides, and audit metadata. Serves as the intermediate state (D7 equivalent)
 * between grade computation (8.1-8.3) and grade publication (Issue #255).
 *
 * Process Context:
 * - Input: Computed final grades from Process 8.3 (via D6 SprintContributionRecord)
 * - Process 8.4 (Issue #253): Coordinator approves + optionally overrides
 * - Output: Approved grades fed to Process 8.5 (Issue #255) for publication
 *
 * Status Lifecycle:
 *   Created (pending) → Coordinator reviews → Approved (8.4) → Published (8.5)
 *   OR: Created (pending) → Coordinator reviews → Rejected (terminal)
 *
 * ================================================================================
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ISSUE #253: Define status enum for grade lifecycle
 * - pending: Grade computed but awaiting coordinator approval
 * - approved: Coordinator reviewed and approved (ready for publication)
 * - rejected: Coordinator explicitly rejected grades
 * - published: Grades published to D7 (Issue #255 completed)
 */
const FINAL_GRADE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PUBLISHED: 'published'
};

/**
 * ISSUE #253: Define override entry sub-schema
 * Captures per-student manual overrides applied during approval
 */
const overrideEntrySchema = new mongoose.Schema(
  {
    _id: false,
    // ISSUE #253: Student ID for this override
    studentId: {
      type: String,
      required: true
    },
    // ISSUE #253: Original computed grade (before override)
    // Used to show coordinator what was computed vs what they're changing
    originalFinalGrade: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    // ISSUE #253: Override grade applied by coordinator
    // Must be different from original (otherwise not an override)
    overriddenFinalGrade: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    // ISSUE #253: Justification for the override (audit requirement)
    // Why did coordinator change the grade? (e.g., "Exceptional contribution", "Medical grounds")
    comment: {
      type: String,
      default: null
    },
    // ISSUE #253: When was this override recorded?
    // Useful for compliance tracking
    overriddenAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

/**
 * ISSUE #253: Main FinalGrade Schema
 * Represents the approval state and finalized grade for one student in one group
 */
const finalGradeSchema = new mongoose.Schema(
  {
    // =========================================================================
    // ISSUE #253: Identity & Context Fields
    // =========================================================================

    /**
     * ISSUE #253: Unique ID for this final grade record
     * Format: fg_<group>_<student>_<timestamp>
     * Used for audit trail and linking from Issue #255
     */
    finalGradeId: {
      type: String,
      required: true,
      unique: true,
      default: () => `fg_${uuidv4().split('-')[0]}`
    },

    /**
     * ISSUE #253: Group context (D2 reference)
     * All grades must belong to a group
     */
    groupId: {
      type: String,
      required: true,
      index: true
    },

    /**
     * ISSUE #253: Student receiving this grade (D1 reference)
     * Each student gets one final grade per group
     */
    studentId: {
      type: String,
      required: true,
      index: true
    },

    /**
     * ISSUE #253 HARDENING: Publish cycle identifier for versioned approvals.
     * Ensures approvals are deduplicated per group + cycle.
     */
    publishCycle: {
      type: String,
      required: true,
      index: true
    },

    // =========================================================================
    // ISSUE #253: Computed Grade Fields (Input from Process 8.3)
    // =========================================================================

    /**
     * ISSUE #253: Base group score (computed, read-only)
     * This is the score before any individual adjustments
     * From: ContributionRecord.baseGroupScore (D6)
     */
    baseGroupScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },

    /**
     * ISSUE #253: Individual contribution ratio (computed, read-only)
     * This is the ratio of student's completed work vs group total
     * From: ContributionRecord.contributionRatio (D6)
     * Formula: storyPointsCompleted / groupTotalStoryPoints
     */
    individualRatio: {
      type: Number,
      required: true,
      min: 0,
      max: 1
    },

    /**
     * ISSUE #253: Computed final grade (before overrides)
     * This is what the algorithm calculated before coordinator intervention
     * Formula: baseGroupScore * individualRatio
     * Range: 0-100 (derived from base score)
     * Important: Keep original for audit trail (don't overwrite with override)
     */
    computedFinalGrade: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },

    // =========================================================================
    // ISSUE #253: Approval State Fields (Set by Process 8.4)
    // =========================================================================

    /**
     * ISSUE #253: Current status of grade approval
     * - pending: Awaiting coordinator review
     * - approved: Coordinator approved (ready for Issue #255 publication)
     * - rejected: Coordinator rejected (terminal state)
     * - published: Grade published to D7 (Issue #255 completed)
     */
    status: {
      type: String,
      enum: Object.values(FINAL_GRADE_STATUS),
      default: FINAL_GRADE_STATUS.PENDING,
      index: true
    },

    /**
     * ISSUE #253: Coordinator ID who approved the grade
     * Identifies the person responsible for approval decision
     * Required once status changes from pending to approved/rejected
     */
    approvedBy: {
      type: String,
      default: null
    },

    /**
     * ISSUE #253: When the coordinator approved this grade
     * Timestamp for audit trail and Process 8.5 publish operation
     * Required once status changes from pending to approved
     */
    approvedAt: {
      type: Date,
      default: null
    },

    /**
     * ISSUE #253: Approval decision reason/comment
     * Why did coordinator approve? Any special circumstances?
     * Optional but encouraged for rejected grades
     */
    approvalComment: {
      type: String,
      default: null
    },

    // =========================================================================
    // ISSUE #253: Override Fields (Optional, set during approval)
    // =========================================================================

    /**
     * ISSUE #253: Was this grade manually overridden by coordinator?
     * If true, see overriddenFinalGrade and overrideComment fields
     * False = computed grade used as-is
     */
    overrideApplied: {
      type: Boolean,
      default: false
    },

    /**
     * ISSUE #253: Final grade after override (if override applied)
     * This is what gets published if override exists
     * If no override: this remains null (use computedFinalGrade instead)
     */
    overriddenFinalGrade: {
      type: Number,
      default: null,
      min: 0,
      max: 100
    },

    /**
     * ISSUE #253 HARDENING: Durable storage of pre-override value.
     * Stored side-by-side with overriddenFinalGrade for audit traceability.
     */
    originalFinalGrade: {
      type: Number,
      default: null,
      min: 0,
      max: 100
    },

    /**
     * ISSUE #253: Who applied the override?
     * Same as approvedBy if override applied during approval
     */
    overriddenBy: {
      type: String,
      default: null
    },

    /**
     * ISSUE #253: Why was grade overridden?
     * Justification for deviation from computed grade
     * Example: "Medical circumstances", "Exceptional contribution", "Calculation error"
     */
    overrideComment: {
      type: String,
      default: null
    },

    /**
     * ISSUE #253: Entry-level overrides list (if multiple students in batch)
     * Not typically used for single-student endpoint but included for future batch operations
     */
    overrideEntries: {
      type: [overrideEntrySchema],
      default: []
    },

    // =========================================================================
    // ISSUE #253: Publication Fields (Set by Process 8.5, Issue #255)
    // =========================================================================

    /**
     * ISSUE #253: When was this grade published?
     * Null until Issue #255 publishes grades
     * Used to verify grades were published
     */
    publishedAt: {
      type: Date,
      default: null
    },

    /**
     * ISSUE #253: Who published the grades?
     * Coordinator ID who initiated publication (Issue #255)
     */
    publishedBy: {
      type: String,
      default: null
    },

    // =========================================================================
    // ISSUE #253: Audit & Metadata Fields
    // =========================================================================

    /**
     * ISSUE #253: Timestamps for audit trail
     * createdAt: When was this record first created (after computation)?
     * updatedAt: When was it last modified?
     */
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    collection: 'final_grades'
  }
);

// ================================================================================
// ISSUE #253: INDEXES FOR EFFICIENT QUERIES
// ================================================================================

/**
 * ISSUE #253: Unique constraint on (groupId, studentId)
 * Ensures one final grade per student per group
 * Prevents duplicates; used for upsert operations
 */
finalGradeSchema.index(
  { groupId: 1, publishCycle: 1, studentId: 1 },
  { unique: true, name: 'idx_final_grade_unique_group_cycle_student' }
);

/**
 * ISSUE #253: Query grades by status and approval time
 * Use case: Find all approved grades ready for publication
 * Query: db.final_grades.find({ status: 'approved', approvedAt: { $lt: now } })
 */
finalGradeSchema.index(
  { status: 1, approvedAt: -1 },
  { name: 'idx_final_grade_status_approved_time' }
);

/**
 * ISSUE #253: Query grades by group (for batch operations)
 * Use case: Find all grades for a group (e.g., to publish all at once)
 * Query: db.final_grades.find({ groupId: 'g123', status: 'approved' })
 */
finalGradeSchema.index(
  { groupId: 1, status: 1 },
  { name: 'idx_final_grade_group_status' }
);

/**
 * ISSUE #253: Query grades by student (for student dashboard)
 * Use case: Student views their grades across all groups
 * Query: db.final_grades.find({ studentId: 's456' })
 */
finalGradeSchema.index(
  { studentId: 1, createdAt: -1 },
  { name: 'idx_final_grade_student_created' }
);

// ================================================================================
// ISSUE #253: INSTANCE METHODS
// ================================================================================

/**
 * ISSUE #253: Mark grade as approved by coordinator
 * Transitions: pending → approved
 * @param {String} coordinatorId - Coordinator performing approval
 * @param {Number} overriddenFinalGrade - Optional override grade
 * @param {String} comment - Optional approval comment
 */
finalGradeSchema.methods.approve = async function(
  coordinatorId,
  overriddenFinalGrade = null,
  comment = null
) {
  // ISSUE #253: Update approval fields
  this.status = FINAL_GRADE_STATUS.APPROVED;
  this.approvedBy = coordinatorId;
  this.approvedAt = new Date();
  this.approvalComment = comment;

  // ISSUE #253: If override provided, record it
  if (overriddenFinalGrade !== null && overriddenFinalGrade !== undefined) {
    this.overrideApplied = true;
    this.overriddenFinalGrade = overriddenFinalGrade;
    this.overriddenBy = coordinatorId;
    this.overrideComment = comment;
  }

  return this.save();
};

/**
 * ISSUE #253: Mark grade as rejected by coordinator
 * Transitions: pending → rejected (terminal)
 * @param {String} coordinatorId - Coordinator performing rejection
 * @param {String} reason - Why was grade rejected?
 */
finalGradeSchema.methods.reject = async function(coordinatorId, reason = null) {
  // ISSUE #253: Update rejection fields
  this.status = FINAL_GRADE_STATUS.REJECTED;
  this.approvedBy = coordinatorId;
  this.approvedAt = new Date();
  this.approvalComment = reason || 'Rejected by coordinator';

  return this.save();
};

/**
 * ISSUE #253: Mark grade as published
 * Transitions: approved → published
 * Called by Issue #255 (publish process)
 * @param {String} coordinatorId - Who initiated publication?
 */
finalGradeSchema.methods.publish = async function(coordinatorId) {
  // ISSUE #253: Update publication fields
  this.status = FINAL_GRADE_STATUS.PUBLISHED;
  this.publishedAt = new Date();
  this.publishedBy = coordinatorId;

  return this.save();
};

/**
 * ISSUE #253: Get the effective final grade (override or computed)
 * Returns: overriddenFinalGrade if override applied, else computedFinalGrade
 * Used by Issue #255 when publishing
 */
finalGradeSchema.methods.getEffectiveFinalGrade = function() {
  // ISSUE #253: Use override if available, fall back to computed
  return this.overrideApplied && this.overriddenFinalGrade !== null
    ? this.overriddenFinalGrade
    : this.computedFinalGrade;
};

// ================================================================================
// ISSUE #253: STATIC METHODS
// ================================================================================

/**
 * ISSUE #253: Find all grades by status for a group
 * Use case: Coordinator views pending grades for approval
 * @param {String} groupId - Group to query
 * @param {String} status - Status enum value
 * @returns {Array} Matching FinalGrade documents
 */
finalGradeSchema.statics.findByGroupAndStatus = function(groupId, status) {
  return this.find({ groupId, status }).sort({ createdAt: -1 });
};

/**
 * ISSUE #253: Find all approved grades ready for publication
 * Use case: Issue #255 fetches approved grades to publish
 * @param {String} groupId - Group to query
 * @returns {Array} All approved but not yet published grades
 */
finalGradeSchema.statics.findApprovedByGroup = function(groupId, publishCycle = null) {
  const query = {
    groupId,
    status: FINAL_GRADE_STATUS.APPROVED,
    publishedAt: null
  };

  if (publishCycle !== null && publishCycle !== undefined) {
    query.publishCycle = publishCycle;
  }

  return this.find({
    ...query
  }).sort({ approvedAt: -1 });
};

/**
 * ISSUE #253: Check if any grade already approved for this group
 * Use case: Prevent duplicate approval attempts (409 Conflict)
 * @param {String} groupId - Group to check
 * @returns {Boolean} True if any grade already approved
 */
finalGradeSchema.statics.hasTerminalGrades = async function(groupId, publishCycle) {
  const count = await this.countDocuments({
    groupId,
    publishCycle,
    status: {
      $in: [
        FINAL_GRADE_STATUS.APPROVED,
        FINAL_GRADE_STATUS.REJECTED,
        FINAL_GRADE_STATUS.PUBLISHED
      ]
    }
  });

  return count > 0;
};

/**
 * ISSUE #253: Get summary stats for a group's grades
 * Use case: Coordinator dashboard shows approval progress
 * @param {String} groupId - Group to analyze
 * @returns {Object} Summary with counts by status
 */
finalGradeSchema.statics.getSummary = async function(groupId) {
  const summary = await this.aggregate([
    { $match: { groupId } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgGrade: { $avg: '$computedFinalGrade' }
      }
    }
  ]);

  return summary;
};

// ================================================================================
// ISSUE #253: EXPORTS
// ================================================================================

const FinalGrade = mongoose.model('FinalGrade', finalGradeSchema);

module.exports = {
  FinalGrade,
  FINAL_GRADE_STATUS,
  finalGradeSchema
};
