const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * AdvisorAssignment — Historical audit trail for all advisor state transitions.
 * * Tracks every assignment, release, and transfer operation to maintain a complete
 * audit trail per group (Process 3.5).
 * Uses Group document _id as groupRef plus denormalized groupId (API string)
 * for maximum query flexibility and performance.
 */
const advisorAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: String,
      default: () => `asn_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    // advisorId refers to the userId of the professor assigned to the group
    advisorId: {
      type: String,
      required: true,
      index: true,
    },
    previousAdvisorId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      // Union of enums to support both main and feature branch lifecycle states
      enum: ['active', 'assigned', 'released', 'transferred'],
      required: true,
    },
    /** userId of the person (Team Leader, Coordinator, or Admin) who triggered this update */
    updatedBy: {
      type: String,
      required: true,
    },
    /** When the advisor was assigned to the group */
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    /** When the advisor was released/transferred (null if currently active) */
    releasedAt: {
      type: Date,
      default: null,
    },
    /** userId of the team leader or admin who initiated the release (legacy support) */
    releasedBy: {
      type: String,
      default: null,
    },
    // Standardized reason field for all transitions (maxlength from feature/65)
    reason: {
      type: String,
      default: '',
      maxlength: 1000,
    },
    // Metadata for storing flexible operation-specific data (Process 3.6 extensions)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

/** * COMPOUND INDEXES
 * Optimized for frequent query patterns in the advisor association flow.
 */

// Query pattern: Find all assignments for a group in specific status
advisorAssignmentSchema.index({ groupId: 1, status: 1 });

// Query pattern: Find historical audit trail - newest assignments for a group first
advisorAssignmentSchema.index({ groupId: 1, createdAt: -1 });

// Query pattern: Find all historical groups assigned to a specific professor
advisorAssignmentSchema.index({ advisorId: 1, createdAt: -1 });

const AdvisorAssignment = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);

module.exports = AdvisorAssignment;