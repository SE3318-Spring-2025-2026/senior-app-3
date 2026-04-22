'use strict';

/**
 * githubSync.js — Controller for Process 7.2
 *
 * POST /groups/:groupId/sprints/:sprintId/github-sync
 *
 * Architectural contract:
 *   - Acquires distributed lock using GitHubSyncJob status flag in D6
 *   - Responds 202 Accepted immediately, then fires the async worker
 *   - Returns 409 Conflict if a sync is already IN_PROGRESS for the same key
 *
 * Error mapping (see spec §3):
 *   202  — job_id + status: "PENDING"    → Job accepted and worker dispatched
 *   409  — SYNC_ALREADY_RUNNING          → Lock already held
 *   400  — INVALID_GITHUB_CREDENTIALS    → D2 missing/invalid PAT or repo binding
 *   404  — JIRA_DATA_MISSING             → D6 empty for this sprint (Process 7.1 hasn't run)
 *   502  — UPSTREAM_PROVIDER_ERROR       → GitHub API returned 5xx (post-sync, worker-side)
 *   504  — GATEWAY_TIMEOUT              → GitHub API timed-out after all retries (worker-side)
 *
 * Auth:
 *   Requires coordinator or advisor role (group members cannot self-trigger a mass sync)
 *
 * DFD flows:
 *   f29 — Coordinator → 7.2 (trigger sync)
 *   f30 — 7.2 → D6 create GitHubSyncJob (lock acquired)
 *   f31 — 7.2 → Worker (async)
 */

const GitHubSyncJob = require('../models/GitHubSyncJob');
const Group = require('../models/Group');
const SprintRecord = require('../models/SprintRecord');
const { githubSyncWorker, GitHubSyncError } = require('../services/githubSyncService');
const { createAuditLog } = require('../services/auditService');

/**
 * POST /groups/:groupId/sprints/:sprintId/github-sync
 *
 * Concurrency guard (lock key = sync:{groupId}:{sprintId}):
 *   If IN_PROGRESS job exists → 409
 *   Otherwise → create PENDING job, return 202, fire async worker
 */
const triggerGitHubSync = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';

  try {
    // ── Guard: verify group exists (D2 sanity check) ────────────────────────
    const group = await Group.findOne({ groupId }).lean();
    if (!group) {
      return res.status(404).json({
        error: 'JIRA_DATA_MISSING',
        message: `Group ${groupId} not found`,
      });
    }

    // ── Guard: GitHub must be configured (D2) ───────────────────────────────
    if (!group.githubPat || !group.githubOrg || !group.githubRepoName) {
      return res.status(400).json({
        error: 'INVALID_GITHUB_CREDENTIALS',
        message: 'GitHub integration is not configured for this group. Call POST /groups/:groupId/github first.',
      });
    }

    // ── Guard: Sprint must have data in D6 ──────────────────────────────────
    const sprintRecord = await SprintRecord.findOne({ sprintId, groupId }).lean();
    if (!sprintRecord) {
      return res.status(404).json({
        error: 'JIRA_DATA_MISSING',
        message: `No sprint record found in D6 for sprint ${sprintId}. Ensure Process 7.1 has completed.`,
      });
    }

    // ── Concurrency lock: check for existing active job ────────────────────
    const existingLock = await GitHubSyncJob.findOne({
      groupId,
      sprintId,
      status: { $in: ['PENDING', 'IN_PROGRESS'] },
    }).lean();

    if (existingLock) {
      return res.status(409).json({
        error: 'SYNC_ALREADY_RUNNING',
        message: `A GitHub sync is already in progress for group ${groupId} / sprint ${sprintId}`,
        job_id: existingLock.jobId,
      });
    }

    // ── Acquire lock: create PENDING job ────────────────────────────────────
    let job;
    try {
      job = await GitHubSyncJob.create({
        groupId,
        sprintId,
        status: 'PENDING',
        triggeredBy: actorId,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Race condition: another request created the job between our findOne and create
        const racingJob = await GitHubSyncJob.findOne({
          groupId,
          sprintId,
          status: { $in: ['PENDING', 'IN_PROGRESS'] },
        }).lean();
        return res.status(409).json({
          error: 'SYNC_ALREADY_RUNNING',
          message: `A GitHub sync was just triggered for group ${groupId} / sprint ${sprintId}`,
          job_id: racingJob?.jobId,
        });
      }
      throw err; // rethrow other DB errors
    }

    // ── Audit: sync initiated (non-fatal) ───────────────────────────────────
    try {
      await createAuditLog({
        action: 'GITHUB_SYNC_INITIATED',
        actorId,
        groupId,
        targetId: job.jobId,
        payload: { sprintId, jobId: job.jobId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditErr) {
      console.error('[triggerGitHubSync] Audit log failed (non-fatal):', auditErr.message);
    }

    // ── Respond 202 immediately ──────────────────────────────────────────────
    res.status(202).json({
      job_id: job.jobId,
      status: 'PENDING',
      message: 'GitHub sync job accepted. PR validation will run asynchronously.',
    });

    // ── Fire async worker (detached — does NOT await response) ──────────────
    // setImmediate ensures the HTTP response is fully flushed before worker runs
    setImmediate(() => {
      githubSyncWorker(groupId, sprintId, job.jobId).catch((err) => {
        console.error('[triggerGitHubSync] Unhandled worker error:', err);
      });
    });

  } catch (err) {
    // Propagation from GitHubSyncError (pre-flight checks)
    if (err instanceof GitHubSyncError) {
      const statusMap = {
        400: { error: 'INVALID_GITHUB_CREDENTIALS' },
        404: { error: 'JIRA_DATA_MISSING' },
        502: { error: 'UPSTREAM_PROVIDER_ERROR' },
        504: { error: 'GATEWAY_TIMEOUT' },
      };
      const body = statusMap[err.status] || { error: 'INTERNAL_ERROR' };
      return res.status(err.status).json({ ...body, message: err.message });
    }
    console.error('[triggerGitHubSync] Unexpected error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

/**
 * mapJobToHttpStatus — helper to derive a frontend-friendly HTTP status
 */
const mapJobToHttpStatus = (status, errorCode) => {
  if (status === 'COMPLETED') return 200;
  if (status === 'PENDING' || status === 'IN_PROGRESS') return 202;
  if (status === 'FAILED') {
    if (errorCode === 'UPSTREAM_PROVIDER_ERROR') return 502;
    if (errorCode === 'GATEWAY_TIMEOUT') return 504;
    return 500;
  }
  return 200;
};

/**
 * GET /groups/:groupId/sprints/:sprintId/github-sync/:jobId
 *
 * Returns the current status and validation records for a specific sync job.
 * Allows callers to poll job progress after receiving the 202.
 */
const getSyncJobStatus = async (req, res) => {
  const { groupId, sprintId, jobId } = req.params;

  try {
    const job = await GitHubSyncJob.findOne({ jobId, groupId, sprintId }).lean();
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `Sync job ${jobId} not found for group ${groupId} / sprint ${sprintId}`,
      });
    }

    return res.status(200).json({
      job_id: job.jobId,
      status: job.status,
      mappedHttpStatus: mapJobToHttpStatus(job.status, job.errorCode),
      groupId: job.groupId,
      sprintId: job.sprintId,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      validationRecords: job.validationRecords,
      createdAt: job.createdAt,
    });
  } catch (err) {
    console.error('[getSyncJobStatus] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

/**
 * GET /groups/:groupId/sprints/:sprintId/github-sync
 *
 * Returns the most recent sync job for a (group, sprint) pair (any status).
 * Useful for dashboard polling without knowing the jobId upfront.
 */
const getLatestSyncJob = async (req, res) => {
  const { groupId, sprintId } = req.params;

  try {
    const job = await GitHubSyncJob.findOne(
      { groupId, sprintId },
      null,
      { sort: { createdAt: -1 } }
    ).lean();

    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `No sync jobs found for group ${groupId} / sprint ${sprintId}`,
      });
    }

    return res.status(200).json({
      job_id: job.jobId,
      status: job.status,
      mappedHttpStatus: mapJobToHttpStatus(job.status, job.errorCode),
      groupId: job.groupId,
      sprintId: job.sprintId,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      validationRecords: job.validationRecords,
      createdAt: job.createdAt,
    });
  } catch (err) {
    console.error('[getLatestSyncJob] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { triggerGitHubSync, getSyncJobStatus, getLatestSyncJob };
