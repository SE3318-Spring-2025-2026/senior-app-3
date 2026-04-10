const mongoose = require('mongoose');

/**
 * Committee Schema (D3 Data Store)
 * 
 * Represents a committee configuration for evaluating group projects.
 * Part of Process 4.0 (Committee Assignment) workflow.
 * 
 * Flows:
 * - f06: 4.5 → D3 (committee publication)
 * - Used by Process 4.1 (draft creation), 4.5 (publication)
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `COM-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    },
    committeeName: {
      type: String,
      required: true,
      unique: true,
      index: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
      maxlength: 500,
      default: null,
    },
    advisorIds: {
      type: [String],
      default: [],
    },
    juryIds: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
      index: true,
    },
    createdBy: {
      type: String, // coordinatorId
      required: true,
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    publishedBy: {
      type: String, // coordinatorId who published
      default: null,
    },
    validatedAt: {
      type: Date,
      default: null,
    },
    validatedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'committees',
  }
);

// Compound indexes for common queries
committeeSchema.index({ createdBy: 1, status: 1 });
committeeSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model('Committee', committeeSchema);
