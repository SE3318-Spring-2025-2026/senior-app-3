const mongoose = require('mongoose');

/**
 * Audit/history of advisor assignments for a group.
 * Uses Group document _id as groupRef (Mongoose ref) plus denormalized groupId (API id string)
 * to match the rest of the codebase.
 */
const advisorAssignmentSchema = new mongoose.Schema(
  {
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
    advisorId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'released', 'transferred'],
      required: true,
    },
    /** When the advisor was assigned; omitted if unknown (legacy data) */
    assignedAt: {
      type: Date,
    },
    releasedAt: {
      type: Date,
    },
    /** userId of the team leader or admin who released the advisor */
    releasedBy: {
      type: String,
    },
    releaseReason: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

advisorAssignmentSchema.index({ groupId: 1, createdAt: -1 });

module.exports = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);
