'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * GitHubSyncJob Schema (D6 supplemental — Process 7.2)
 *
 * Tracks the lifecycle of an asynchronous GitHub PR validation job
 * for a given (group, sprint) pair.  Also serves as the distributed
 * concurrency lock: a document in IN_PROGRESS status means the lock
 * is held (key = sync:{groupId}:{sprintId}).
 *
 * DFD flows:
 *   f30 — POST /groups/:groupId/sprints/:sprintId/github-sync → D6 (create job)
 *   f31 — Worker → D6 (update PR validation records)
 *   f32 — Worker → D6 (release lock / mark COMPLETED or FAILED)
 *
 * Statuses (mirrors job lifecycle):
 *   PENDING     — Job accepted, worker not yet started
 *   IN_PROGRESS — Worker running (== lock held)
 *   COMPLETED   — All issues validated successfully
 *   FAILED      — Worker exhausted retries or hit a fatal error
 */
const prValidationRecordSchema = new mongoose.Schema(
  {
    issueKey: { type: String, required: true },
    prId: { type: String, default: null },
    prUrl: { type: String, default: null },
    mergeStatus: {
      type: String,
      enum: ['MERGED', 'NOT_MERGED', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    lastValidated: { type: Date, default: null },
    rawState: { type: String, default: null }, // GitHub merge_state verbatim
  },
  { _id: false }
);

const gitHubSyncJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      default: () => `ghsync_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    },
    /** D2 reference */
    groupId: { type: String, required: true, index: true },
    /** D6 reference */
    sprintId: { type: String, required: true, index: true },

    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },

    /** Per-issue validation results written by the async worker */
    validationRecords: [prValidationRecordSchema],

    /** Error detail when status = FAILED */
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },

    /** Timestamps for observability */
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    /** Who triggered the sync */
    triggeredBy: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'github_sync_jobs',
  }
);

// Compound lock key: only one IN_PROGRESS job per (group, sprint)
gitHubSyncJobSchema.index({ groupId: 1, sprintId: 1, status: 1 });
// Fast job retrieval by jobId
gitHubSyncJobSchema.index({ jobId: 1 }, { unique: true });

module.exports = mongoose.model('GitHubSyncJob', gitHubSyncJobSchema);
