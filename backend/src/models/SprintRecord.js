const mongoose = require('mongoose');

/**
 * SprintRecord Schema (D6 Data Store)
 * 
 * Tracks sprint-level committee assignments and deliverable cross-references.
 * Part of Process 7 (Sprint Tracking) workflow.
 * 
 * Flows:
 * - f13: 4.5 → D6 (committee assignment to sprint)
 * - f14: D4 → D6 (deliverable cross-reference)
 */
const deliverableRefSchema = new mongoose.Schema(
  {
    deliverableId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['proposal', 'statement-of-work', 'demonstration'],
      required: true,
    },
    submittedAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false }
);

const sprintRecordSchema = new mongoose.Schema(
  {
    sprintRecordId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `SPR-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    },
    sprintId: {
      type: String,
      required: true,
      index: true,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    committeeId: {
      type: String,
      default: null,
      index: true,
    },
    committeeAssignedAt: {
      type: Date,
      default: null,
    },
    deliverableRefs: [deliverableRefSchema],
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'submitted', 'reviewed', 'completed'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
    collection: 'sprint_records',
  }
);

// Compound indexes for common queries
sprintRecordSchema.index({ sprintId: 1, groupId: 1 });
sprintRecordSchema.index({ committeeId: 1, sprintId: 1 });
sprintRecordSchema.index({ groupId: 1, status: 1 });

module.exports = mongoose.model('SprintRecord', sprintRecordSchema);
