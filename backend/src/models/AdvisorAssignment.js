const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Audit/history of advisor assignments for a group.
 * Uses Group document _id as groupRef (Mongoose ref) plus denormalized groupId (API id string)
 * to match the rest of the codebase.
 * Stores both advisory relationships (advisorId/professorId reference) and status changes.
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
    // advisorId refers to the userId of the assigned professor/advisor
    advisorId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      // Combined enums from both main ('active') and feature ('assigned') to prevent validation errors
      enum: ['active', 'assigned', 'released', 'transferred'],
      required: true,
    },
    /** When the advisor was assigned; omitted if unknown (legacy data) */
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    // When the advisor was released (if status: 'released')
    releasedAt: {
      type: Date,
      default: null,
    },
    /** userId of the team leader or admin who released the advisor */
    releasedBy: {
      type: String,
      default: null,
    },
    // Reason for the change (release, transfer, etc.)
    releaseReason: {
      type: String,
      default: '', 
      maxlength: 1000, // feature/65 dalından gelen karakter sınırı
    },
    // For transfer tracking: previous advisor userId
    previousAdvisorId: {
      type: String,
      default: null,
    },
    // Allows storing additional flexible data for future operations (from feature/66)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound indexes for efficient queries
// Query pattern: find all assignments for a group in specific status
advisorAssignmentSchema.index({ groupId: 1, status: 1 });
// Query pattern: find all assignments for an advisor
advisorAssignmentSchema.index({ advisorId: 1 });
// Query pattern: historical audit - latest assignments for a group
advisorAssignmentSchema.index({ groupId: 1, createdAt: -1 });

const AdvisorAssignment = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);

module.exports = AdvisorAssignment;