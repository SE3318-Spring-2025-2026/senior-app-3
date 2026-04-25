'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Evaluation Schema (D5 Data Store)
 *
 * Stores the actual numerical scores given by assigned reviewers.
 * Used during Process 8.1 (Final Grade Preview/Calculation).
 */
const evaluationSchema = new mongoose.Schema(
  {
    evaluationId: {
      type: String,
      unique: true,
      required: true,
      default: () => `eval_${uuidv4().replace(/-/g, '').slice(0, 10)}`,
    },
    deliverableId: {
      type: String,
      required: true,
      ref: 'Deliverable',
      index: true,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    evaluatorId: {
      type: String,
      required: true,
      index: true,
    },
    score: {
      type: Number,
      default: null, // Null indicates the evaluation has not been completed yet
      min: 0,
      max: 100,
    },
    status: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending',
      index: true,
    },
    comments: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'evaluations',
  }
);

// Compound indexes for orchestration queries
evaluationSchema.index({ deliverableId: 1, status: 1 });
evaluationSchema.index({ groupId: 1, deliverableId: 1 });

module.exports = mongoose.model('Evaluation', evaluationSchema);
