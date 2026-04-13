'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const DELIVERABLE_TYPES = [
  'proposal',
  'statement_of_work',
  'demo',
  'interim_report',
  'final_report',
];

const deliverableStagingSchema = new mongoose.Schema(
  {
    stagingId: {
      type: String,
      required: true,
      unique: true,
      default: () => `stg_${uuidv4().replace(/-/g, '').slice(0, 10)}`,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    deliverableType: {
      type: String,
      enum: DELIVERABLE_TYPES,
      required: true,
    },
    sprintId: {
      type: String,
      required: true,
    },
    submittedBy: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: null,
    },
    tempFilePath: {
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
    mimeType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['staging'],
      default: 'staging',
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 60 * 60 * 1000), // +1 hour
    },
  },
  {
    timestamps: true,
    collection: 'deliverable_stagings',
  }
);

// Unique lookup by stagingId
deliverableStagingSchema.index({ stagingId: 1 }, { unique: true });

// TTL index — MongoDB auto-deletes documents once expiresAt is reached
deliverableStagingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DeliverableStaging', deliverableStagingSchema);
