const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Deliverable — D4 data store for student deliverable submissions.
 *
 * Stores submitted deliverables (documents or links) for each group across
 * the project phases (proposal, statement of work, demonstration).
 *
 * Linked to:
 *   - Committee (D3): which committee this submission is for
 *   - Group (D2): which group submitted
 *   - SprintRecord (D6): cross-referenced for contribution tracking
 *
 * Flow f12: Process 4.5 (Deliverable Submission) → D4 write
 * Flow f14: D4 (Deliverable) → D6 (cross-reference ingestion)
 */
const deliverableSchema = new mongoose.Schema(
  {
    deliverableId: {
      type: String,
      default: () => `dlv_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    committeeId: {
      type: String,
      required: true,
      indexed: true,
    },
    groupId: {
      type: String,
      required: true,
      indexed: true,
    },
    studentId: {
      type: String,
      required: true,
      indexed: true,
    },
    type: {
      type: String,
      enum: ['proposal', 'statement_of_work', 'demonstration'],
      required: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    storageRef: {
      type: String,
      required: true,
    },
    format: {
      type: String,
      enum: ['document', 'link', 'file'],
      required: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['submitted', 'accepted', 'rejected'],
      default: 'submitted',
    },
  },
  { timestamps: true }
);

// Indexes for efficient querying
deliverableSchema.index({ deliverableId: 1 });
deliverableSchema.index({ committeeId: 1, groupId: 1 });
deliverableSchema.index({ committeeId: 1, type: 1 });
deliverableSchema.index({ groupId: 1, submittedAt: -1 });
deliverableSchema.index({ studentId: 1, committeeId: 1 });

const Deliverable = mongoose.model('Deliverable', deliverableSchema);

module.exports = Deliverable;
