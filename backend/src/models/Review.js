'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Review Schema (D5 — Review Assignments)
 *
 * Tracks the lifecycle of a review assigned to committee members for a specific
 * deliverable. One review record exists per deliverable; committee members are
 * listed in assignedMembers with their individual acceptance status.
 *
 * Process 6 — Review & Comment workflow.
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
  },
  {
    timestamps: true,
    collection: 'reviews',
  }
);

reviewSchema.index({ deliverableId: 1 }, { unique: true });
reviewSchema.index({ status: 1 });

module.exports = mongoose.model('Review', reviewSchema);
