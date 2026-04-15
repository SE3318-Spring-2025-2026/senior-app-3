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
    deliverableType: {
      type: String,
      enum: ['proposal', 'statement_of_work', 'demo', 'interim_report', 'final_report'],
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
    submittedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
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
