const mongoose = require('mongoose');

/**
 * Deliverable Schema (D4 Data Store)
 * 
 * Represents student project deliverables submitted during committee evaluation.
 * Part of Process 4.5 (Deliverable Submission) workflow.
 * 
 * Flows:
 * - f12: 4.5 → D4 (deliverable submission)
 * - f14: D4 → D6 (cross-reference to sprint records)
 */
const deliverableSchema = new mongoose.Schema(
  {
    deliverableId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `DEL-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    },
    committeeId: {
      type: String,
      required: true,
      index: true,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    studentId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['proposal', 'statement-of-work', 'demonstration'],
      required: true,
      index: true,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    storageRef: {
      type: String,
      required: true,
    },
    sprintId: {
      type: String,
      default: null,
      index: true,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    validationHistory: {
      type: [
        {
          step: {
            type: String,
            enum: ['format_validation', 'deadline_validation', 'storage'],
            required: true,
          },
          passed: { type: Boolean, required: true },
          checkedAt: { type: Date, required: true },
          failureReasons: { type: [String], default: [] },
          _id: false,
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'accepted', 'under_review', 'rejected', 'retracted'],
      default: 'submitted',
    },
    feedback: {
      type: String,
      default: null,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'deliverables',
  }
);

// Compound indexes for common queries
deliverableSchema.index({ committeeId: 1, groupId: 1 });
deliverableSchema.index({ groupId: 1, type: 1 });
deliverableSchema.index({ submittedAt: -1 });

module.exports = mongoose.model('Deliverable', deliverableSchema);
