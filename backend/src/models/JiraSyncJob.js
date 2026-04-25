'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const jiraSyncJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      default: () => `jirasync_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    sprintId: {
      type: String,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['jira'],
      default: 'jira',
    },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    issuesProcessed: {
      type: Number,
      default: 0,
    },
    issuesUpserted: {
      type: Number,
      default: 0,
    },
    errorCode: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    triggeredBy: {
      type: String,
      default: null,
    },
    correlationId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'jira_sync_jobs',
  }
);

jiraSyncJobSchema.index(
  { groupId: 1, sprintId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'IN_PROGRESS'] } },
    name: 'uniq_active_jira_sync_lock',
  }
);

module.exports = mongoose.model('JiraSyncJob', jiraSyncJobSchema);
