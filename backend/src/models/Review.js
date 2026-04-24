'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const evaluationScoreSchema = new mongoose.Schema(
  {
    criterion: {
      type: String,
      required: true,
      trim: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
    },
    maxScore: {
      type: Number,
      required: true,
      min: 0.01,
      default: 100,
    },
    weight: {
      type: Number,
      required: true,
      min: 0.01,
      default: 1,
    },
    ratedBy: {
      type: String,
      required: true,
    },
    ratedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  { _id: false }
);

/**
 * Review Schema (D5 Review Assignments and Evaluations)
 *
 * Tracks the lifecycle of a review assigned to committee members for a specific
 * deliverable. One review record exists per deliverable; committee members are
 * listed in assignedMembers with their individual acceptance status.
 *
 * Process 6 covers review/comment workflow. Process 8.1 consumes the evaluation
 * fields to compute deliverable aggregate scores for final grade preview.
 */
const reviewSchema = new mongoose.Schema(
  {
    reviewId: {
      type: String,
      default: () => `rev_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
      unique: true,
      required: true,
      index: true,
    },
    deliverableId: {
      type: String,
      required: true,
      ref: 'Deliverable',
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'needs_clarification', 'completed'],
      default: 'pending',
      required: true,
    },
    assignedMembers: [
      {
        memberId: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          enum: ['notified', 'accepted', 'started'],
          default: 'notified',
          required: true,
        },
        _id: false,
      },
    ],
    deadline: {
      type: Date,
      required: true,
    },
    instructions: {
      type: String,
      default: null,
    },
    evaluationScores: {
      type: [evaluationScoreSchema],
      default: [],
    },
    aggregateScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    evaluationCompletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'reviews',
  }
);

reviewSchema.index({ deliverableId: 1 }, { unique: true });
reviewSchema.index({ status: 1 });
reviewSchema.index({ groupId: 1, status: 1 });

module.exports = mongoose.model('Review', reviewSchema);
