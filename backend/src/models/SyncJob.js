'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const syncJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      default: () => `sync_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    },
    groupId: { type: String, required: true, index: true },
    sprintId: { type: String, required: true, index: true },
    source: {
      type: String,
      enum: ['jira', 'github'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    message: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    triggeredBy: { type: String, default: null },
    correlationId: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'sync_jobs',
  }
);

syncJobSchema.index(
  { groupId: 1, sprintId: 1, source: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'IN_PROGRESS'] } },
    name: 'uniq_active_sync_lock_by_source',
  }
);

module.exports = mongoose.model('SyncJob', syncJobSchema);
