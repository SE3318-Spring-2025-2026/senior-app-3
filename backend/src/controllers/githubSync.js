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
 *
 * ================================================================================
 * ISSUE #241: Operational Hooks — Idempotency & CorrelationId Integration
 * ================================================================================
 * 
 * Changes for Issue #241:
 * 1. Accept Idempotency-Key header for safe retry semantics (RFC 7231)
 * 2. Propagate correlationId from request through entire sync pipeline
 * 3. Register request fingerprint for duplicate detection
 * 4. Include correlationId in all audit logs for distributed tracing
 * 5. Support webhook delivery for sync completion notifications
 *
 * Client Usage:
 *   POST /groups/{groupId}/sprints/{sprintId}/github-sync
 *   Idempotency-Key: uuid-4-or-your-unique-key
 *   X-Correlation-ID: corr_timestamp_random (optional, generated if not provided)
 *   
 *   Response (idempotent):
 *   - First call: 202 Accepted (sync job created)
 *   - Retry with same Idempotency-Key: 200 OK (returns existing job)
 */

const GitHubSyncJob = require('../models/GitHubSyncJob');
const Group = require('../models/Group');
const SprintRecord = require('../models/SprintRecord');
const { githubSyncWorker, GitHubSyncError } = require('../services/githubSyncService');
const { createAuditLog } = require('../services/auditService');

// ISSUE #241: Import middleware and services
const { getCorrelationId } = require('../middleware/correlationId');
const { enforceIdempotency, registerSignature } = require('../services/syncDeduplicationService');
const { dispatchWebhook } = require('../services/webhookDeliveryService');
const { WebhookSignature } = require('../models/WebhookSignature');

/**
 * POST /groups/:groupId/sprints/:sprintId/github-sync
 *
 * ISSUE #241: Enhanced with idempotency and correlationId
 *
 * Concurrency guard (lock key = sync:{groupId}:{sprintId}):
 *   If IN_PROGRESS job exists → 409
 *   Otherwise → create PENDING job, return 202, fire async worker
 *
 * Idempotency (ISSUE #241):
 *   If Idempotency-Key header present:
 *   - Compute SHA256 fingerprint of request
 *   - Check WebhookSignature for duplicate
 *   - If found: Return 200 with existing jobId (RFC 7231 idempotency)
 *   - If not found: Create new job and register signature
 */
const triggerGitHubSync = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';

  // ISSUE #241: Extract correlationId from request (or generate new one)
  // Attach to request for propagation through entire sync pipeline
  const correlationId = getCorrelationId(req);

  try {
    // =========================================================================
    // ISSUE #241: Step 1 — Enforce idempotency
    // =========================================================================
    // Check for duplicate requests using fingerprint-based deduplication
    const idempotencyStatus = await enforceIdempotency(req, res);

    if (!idempotencyStatus.valid) {
      // ISSUE #241: Invalid idempotency key format
      return res.status(idempotencyStatus.statusCode).json({
        error: 'INVALID_IDEMPOTENCY_KEY',
        message: idempotencyStatus.error,
        correlationId
      });
    }

    if (idempotencyStatus.isDuplicate) {
      // ISSUE #241: Duplicate request detected — return existing job
      // This provides safe retry semantics (RFC 7231)
      const existingJob = await GitHubSyncJob.findOne({ jobId: idempotencyStatus.webhookId }).lean();
      
      if (existingJob) {
        // ISSUE #241: Log duplicate request detection
        await createAuditLog({
          action: 'DUPLICATE_REQUEST_DETECTED',
          actorId,
          groupId,
          targetId: existingJob.jobId,
          payload: {
            correlationId,
            idempotencyKey: req.idempotencyKey,
            replayCount: idempotencyStatus.replayCount,
            originalRequest: new Date(idempotencyStatus.firstSeenAt)
          }
        }).catch(err => console.error('ISSUE #241: Audit log error:', err.message));

        // ISSUE #241: Return existing job with 200 OK (idempotent response)
        return res.status(200).json({
          job_id: existingJob.jobId,
          status: existingJob.status,
          message: 'Returning existing job (idempotent replay)',
          correlationId,
          replay: true,
          replayCount: idempotencyStatus.replayCount
        });
      }
    }

    // ========================================================================
    // ISSUE #241: Step 2 — Original flow (with correlationId propagation)
    // ========================================================================

    // ── Guard: verify group exists (D2 sanity check) ────────────────────────
    const group = await Group.findOne({ groupId }).lean();
    if (!group) {
      return res.status(404).json({
        error: 'JIRA_DATA_MISSING',
        message: `Group ${groupId} not found`,
        correlationId
      });
    }

    // ── Guard: GitHub must be configured (D2) ───────────────────────────────
    if (!group.githubPat || !group.githubOrg || !group.githubRepoName) {
      return res.status(400).json({
        error: 'INVALID_GITHUB_CREDENTIALS',
        message: 'GitHub integration is not configured for this group. Call POST /groups/:groupId/github first.',
        correlationId
      });
    }

    // ── Guard: Sprint must have data in D6 ──────────────────────────────────
    const sprintRecord = await SprintRecord.findOne({ sprintId, groupId }).lean();
    if (!sprintRecord) {
      return res.status(404).json({
        error: 'JIRA_DATA_MISSING',
        message: `No sprint record found in D6 for sprint ${sprintId}. Ensure Process 7.1 has completed.`,
        correlationId
      });
    }

    // ── Concurrency lock: check for existing IN_PROGRESS job ────────────────
    const existingLock = await GitHubSyncJob.findOne({
      groupId,
      sprintId,
      status: 'IN_PROGRESS',
    }).lean();

    if (existingLock) {
      return res.status(409).json({
        error: 'SYNC_ALREADY_RUNNING',
        message: `A GitHub sync is already in progress for group ${groupId} / sprint ${sprintId}`,
        job_id: existingLock.jobId,
        correlationId
      });
    }

    // ── Acquire lock: create PENDING job ────────────────────────────────────
    const job = await GitHubSyncJob.create({
      groupId,
      sprintId,
      status: 'PENDING',
      triggeredBy: actorId,
      // ISSUE #241: Attach correlationId to job for tracing
      correlationId,
      // ISSUE #241: Attach idempotency key for tracking
      idempotencyKey: req.idempotencyKey,
      fingerprint: req.fingerprint
    });

    // ========================================================================
    // ISSUE #241: Step 3 — Register signature for duplicate detection
    // ========================================================================
    // Store this request's fingerprint so future retries are detected
    try {
      await registerSignature({
        fingerprint: req.fingerprint,
        idempotencyKey: req.idempotencyKey,
        webhookId: job.jobId,
        context: {
          endpoint: `/groups/${groupId}/sprints/${sprintId}/github-sync`,
          method: 'POST',
          userId: actorId,
          correlationId,
          clientIp: req.ip
        }
      });

      // ISSUE #241: Log signature registration
      await createAuditLog({
        action: 'IDEMPOTENCY_KEY_VALIDATED',
        actorId,
        groupId,
        targetId: job.jobId,
        payload: {
          correlationId,
          idempotencyKey: req.idempotencyKey,
          fingerprint: req.fingerprint
        }
      }).catch(err => console.error('ISSUE #241: Audit log error:', err.message));
    } catch (signatureErr) {
      console.error('ISSUE #241: Signature registration error (non-fatal):', signatureErr.message);
      // Continue even if signature registration fails
    }

    // ── Audit: sync initiated (non-fatal) ───────────────────────────────────
    try {
      await createAuditLog({
        action: 'GITHUB_SYNC_INITIATED',
        actorId,
        groupId,
        targetId: job.jobId,
        payload: {
          correlationId,
          sprintId,
          jobId: job.jobId,
          idempotencyKey: req.idempotencyKey
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditErr) {
      console.error('[triggerGitHubSync] Audit log failed (non-fatal):', auditErr.message);
    }

    // – Respond 202 immediately ──────────────────────────────────────────────
    res.status(202).json({
      job_id: job.jobId,
      status: 'PENDING',
      message: 'GitHub sync job accepted. PR validation will run asynchronously.',
      correlationId,
      idempotencyKey: req.idempotencyKey
    });

    // =========================================================================
    // ISSUE #241: Step 4 — Fire async worker with correlationId
    // =========================================================================
    // setImmediate ensures the HTTP response is fully flushed before worker runs
    setImmediate(() => {
      githubSyncWorker(groupId, sprintId, job.jobId, correlationId).catch((err) => {
        console.error(`[${correlationId}] triggerGitHubSync: Unhandled worker error:`, err);
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
      return res.status(err.status).json({ ...body, message: err.message, correlationId });
    }
    console.error(`[${correlationId}] [triggerGitHubSync] Unexpected error:`, err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId
    });
  }
};
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
 * GET /groups/:groupId/sprints/:sprintId/github-sync/:jobId
 *
 * Returns the current status and validation records for a specific sync job.
 * Allows callers to poll job progress after receiving the 202.
 *
 * ISSUE #241: Enhanced response includes correlationId for tracing
 */
const getSyncJobStatus = async (req, res) => {
  const { groupId, sprintId, jobId } = req.params;

  // ISSUE #241: Extract correlationId from request for logging
  const correlationId = getCorrelationId(req);

  try {
    const job = await GitHubSyncJob.findOne({ jobId, groupId, sprintId }).lean();
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `Sync job ${jobId} not found for group ${groupId} / sprint ${sprintId}`,
        correlationId
      });
    }

    return res.status(200).json({
      job_id: job.jobId,
      status: job.status,
      groupId: job.groupId,
      sprintId: job.sprintId,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      validationRecords: job.validationRecords,
      // ISSUE #241: Include correlationId for tracing
      correlationId: job.correlationId,
      // ISSUE #241: Include idempotency info
      idempotencyKey: job.idempotencyKey,
      createdAt: job.createdAt,
    });
  } catch (err) {
    console.error(`[${correlationId}] [getSyncJobStatus] Error:`, err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId
    });
  }
};

/**
 * GET /groups/:groupId/sprints/:sprintId/github-sync
 *
 * Returns the most recent sync job for a (group, sprint) pair (any status).
 * Useful for dashboard polling without knowing the jobId upfront.
 *
 * ISSUE #241: Enhanced response includes correlationId for tracing
 */
const getLatestSyncJob = async (req, res) => {
  const { groupId, sprintId } = req.params;

  // ISSUE #241: Extract correlationId from request for logging
  const correlationId = getCorrelationId(req);

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
        correlationId
      });
    }

    return res.status(200).json({
      job_id: job.jobId,
      status: job.status,
      groupId: job.groupId,
      sprintId: job.sprintId,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      validationRecords: job.validationRecords,
      // ISSUE #241: Include correlationId for tracing
      correlationId: job.correlationId,
      // ISSUE #241: Include idempotency info
      idempotencyKey: job.idempotencyKey,
      createdAt: job.createdAt,
    });
  } catch (err) {
    console.error(`[${correlationId}] [getLatestSyncJob] Error:`, err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId
    });
  }
};

module.exports = { triggerGitHubSync, getSyncJobStatus, getLatestSyncJob };
