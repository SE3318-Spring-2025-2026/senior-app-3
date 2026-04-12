const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Committee Schema (D2 Data Store)
 * 
 * Represents a committee that evaluates student deliverables.
 * Part of Process 4.5 (Deliverable Submission) and Process 8.1 (Jury Assignment).
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      default: () => `com_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    description: {
      type: String,
      default: null,
    },
    createdBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'committees',
  }
);

// Index for status and committeeId
committeeSchema.index({ status: 1 });

module.exports = mongoose.model('Committee', committeeSchema);
