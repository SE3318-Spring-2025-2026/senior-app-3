'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Deliverable Schema (D4 Data Store)
 *
 * Represents the permanent record created after Process 5.5 (file storage).
 * Flows:
 *   f12: Process 5.5 → D4 (deliverable stored)
 *   f14: D4 → D6 (cross-reference to sprint records)
 */
const deliverableSchema = new mongoose.Schema(
  {
    deliverableId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `del_${uuidv4().replace(/-/g, '').slice(0, 10)}`,
    },
    groupId: {
      type: String,
      required: true,
    },
    committeeId: {
      type: String,
      default: null,
    },
    deliverableType: {
      type: String,
      enum: ['proposal', 'statement_of_work', 'statement-of-work', 'demo', 'demonstration', 'interim_report', 'final_report'],
      required: true,
    },
    sprintId: {
      type: String,
      default: null,
    },
    submittedBy: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: null,
    },
    filePath: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    fileHash: {
      type: String,
      required: true,
    },
    format: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['accepted', 'under_review', 'awaiting_resubmission', 'evaluated', 'retracted'],
      default: 'accepted',
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
    submittedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'deliverables',
  }
);

// Indexes per spec
deliverableSchema.index({ groupId: 1, createdAt: -1 });
deliverableSchema.index({ status: 1 });
deliverableSchema.index({ groupId: 1, deliverableType: 1, sprintId: 1 });

module.exports = mongoose.model('Deliverable', deliverableSchema);
