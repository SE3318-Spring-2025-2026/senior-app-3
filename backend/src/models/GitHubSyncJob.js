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
 * ISSUE #235 INTEGRATION: prValidationRecordSchema now includes PR author/reviewers
 * for Process 7.3 (Story Point Attribution). When GitHub sync completes, Process 7.3
 * reads these validationRecords to map GitHub usernames → studentId.
 *
 * DFD flows:
 *   f30 — POST /groups/:groupId/sprints/:sprintId/github-sync → D6 (create job)
 *   f31 — Worker → D6 (update PR validation records)
 *   f32 — Worker → D6 (release lock / mark COMPLETED or FAILED)
 *   f33 — ISSUE #235: Process 7.3 reads validationRecords for attribution
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

    // ═════════════════════════════════════════════════════════════════════════════
    // ISSUE #235 FIELDS: GitHub PR metadata for attribution
    // ═════════════════════════════════════════════════════════════════════════════
    // These fields are written by githubSyncService (Process 7.2) and read by
    // attributionService (Process 7.3) to map GitHub PR authors to studentId.
    //
    // prAuthor: GitHub username of the PR author
    //   - PRIMARY RULE: Used to attribute story points to student
    //   - Maps via D1 (User.githubUsername) to find studentId
    //   - Must be approved member of group (D2) to receive attribution
    //
    // prReviewers: Array of GitHub usernames of PR reviewers
    //   - FALLBACK: Used if PR author not found or configuration permits
    //   - Processed in order (first matching reviewer gets attribution)
    //
    // storyPoints: Story point count from JIRA issue
    //   - Read from Process 7.1 (JIRA sync) metadata
    //   - Added to studentId's storyPointsCompleted in ContributionRecord
    //   - Only counted if mergeStatus === 'MERGED'
    //
    // jiraAssignee: JIRA issue assignee (optional, for fallback rules)
    //   - FALLBACK ONLY: Used if GitHub mapping fails AND useJiraFallback enabled
    //   - Same D1 + D2 validation applies
    // ═════════════════════════════════════════════════════════════════════════════

    prAuthor: {
      type: String,
      default: null, // GitHub username of PR author
    },
    prReviewers: {
      type: [String],
      default: [], // Array of GitHub usernames
    },
    storyPoints: {
      type: Number,
      default: 0, // From JIRA sync (Process 7.1)
    },
    jiraAssignee: {
      type: String,
      default: null, // JIRA issue assignee (fallback only)
    },
  },
  { _id: false }
);

const gitHubSyncJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      default: () => `ghsync_${uuidv4().replaceAll('-', '').slice(0, 16)}`,
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

    // =========================================================================
    // ISSUE #241: Operational Hooks & Idempotency Fields
    // =========================================================================

    /**
     * ISSUE #241: CorrelationId for distributed tracing
     * Links this job to the HTTP request that triggered it.
     * Used to correlate logs across GitHub sync, JIRA, notifications, and audits.
     */
    correlationId: {
      type: String,
      index: true,
      default: null
    },

    /**
     * ISSUE #241: Idempotency key from client
     * Allows client to safely retry the POST request with same key.
     * If not provided in request, a generated UUID is stored.
     */
    idempotencyKey: {
      type: String,
      index: true,
      default: null
    },
    externalRequestId: {
      type: String,
      index: true,
      default: null
    },

    /**
     * ISSUE #241: Request fingerprint (SHA256 hash)
     * SHA256(JSON.stringify(payload) + idempotencyKey)
     * Used for deduplication and detecting replay attacks.
     */
    fingerprint: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'github_sync_jobs',
  }
);

// Compound lock key: only one PENDING or IN_PROGRESS job per (group, sprint)
gitHubSyncJobSchema.index(
  { groupId: 1, sprintId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'IN_PROGRESS'] } },
    name: 'uniq_active_sync_lock',
  }
);
// Fast job retrieval by jobId
gitHubSyncJobSchema.index({ jobId: 1 }, { unique: true });

// =========================================================================
// ISSUE #241: Indexes for operational tracking
// =========================================================================

// ISSUE #241: Index for correlationId tracing
// Query: find all sync jobs triggered by same request
gitHubSyncJobSchema.index({ correlationId: 1, createdAt: -1 });

// ISSUE #241: Index for idempotency key
// Query: find sync job by idempotency key (for replay detection)
gitHubSyncJobSchema.index({ idempotencyKey: 1, fingerprint: 1 });
gitHubSyncJobSchema.index(
  { idempotencyKey: 1, fingerprint: 1 },
  {
    unique: true,
    name: 'uniq_idempotency_fingerprint',
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
      fingerprint: { $type: 'string' },
    }
  }
);
gitHubSyncJobSchema.index({ groupId: 1, sprintId: 1, jobId: 1 });
gitHubSyncJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('GitHubSyncJob', gitHubSyncJobSchema);
