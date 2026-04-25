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
 *   202  — jobId + status: "queued"      → Job accepted and worker dispatched
 *   409  — SYNC_ALREADY_RUNNING          → Lock already held
 *   400  — INVALID_GITHUB_CREDENTIALS    → D2 missing/invalid PAT or repo binding
 *   404  — JIRA_DATA_MISSING             → D6 empty for this sprint (Process 7.1 hasn't run)
 *   502  — UPSTREAM_PROVIDER_ERROR       → GitHub API returned 5xx (post-sync, worker-side)
 *   504  — GATEWAY_TIMEOUT              → GitHub API timed-out after all retries (worker-side)
 *
 * Auth:
 *   Requires coordinator/admin role (group members cannot self-trigger a mass sync)
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
const { logError } = require('../utils/structuredLogger');

// ISSUE #241: Import middleware and services
const { getCorrelationId } = require('../middleware/correlationId');
const {
  enforceIdempotency,
  acquireIdempotencySignature
} = require('../services/syncDeduplicationService');
const ALLOWED_SYNC_ROLES = new Set(['coordinator', 'admin']);

const toPublicStatus = (status) => {
  if (status === 'PENDING') return 'queued';
  if (status === 'IN_PROGRESS') return 'running';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'queued';
};

const ensureSyncAccess = (req, res) => {
  const role = req.user?.role;
  if (!ALLOWED_SYNC_ROLES.has(role)) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Only coordinator/admin can access GitHub sync endpoints.',
    });
    return false;
  }
  return true;
};

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
  if (!ensureSyncAccess(req, res)) return;
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';
  const correlationId = getCorrelationId(req);
  const externalRequestId = req.externalRequestId || req.headers['x-request-id'] || null;

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

    // ========================================================================
    // ISSUE #241: Step 2 — Original flow (with correlationId propagation)
    // ========================================================================

    // ── Guard: verify group exists (D2 sanity check) ────────────────────────
    const group = await Group.findOne({ groupId }).select('+githubPat').lean();
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

    // ── Guard: Finalized snapshot conflict ──────────────────────────────────
    if (['completed', 'reviewed'].includes(sprintRecord.status)) {
      return res.status(409).json({
        error: 'SNAPSHOT_LOCKED',
        message: `Sprint contribution snapshot for ${groupId}/${sprintId} is already finalized.`,
        correlationId
      });
    }

    // ── Atomic idempotency acquisition: single job per fingerprint ──────────
    let job = null;
    let replayJob = null;
    const session = await GitHubSyncJob.startSession();
    try {
      await session.withTransaction(async () => {
        const proposedJobId = `ghsync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const upsertResult = await GitHubSyncJob.findOneAndUpdate(
          { idempotencyKey: req.idempotencyKey, fingerprint: req.fingerprint },
          {
            $setOnInsert: {
              jobId: proposedJobId,
              groupId,
              sprintId,
              status: 'PENDING',
              triggeredBy: actorId,
              correlationId,
              externalRequestId,
              idempotencyKey: req.idempotencyKey,
              fingerprint: req.fingerprint
            }
          },
          { new: true, upsert: true, includeResultMetadata: true, session }
        );
        job = upsertResult.value;
        const isNewJob = Boolean(upsertResult.lastErrorObject?.upserted);
        if (!isNewJob) {
          replayJob = job;
          return;
        }

        await GitHubSyncJob.updateOne({ _id: job._id }, {
          $set: {
            groupId,
            sprintId,
            status: 'PENDING',
            triggeredBy: actorId,
            correlationId,
            externalRequestId,
            idempotencyKey: req.idempotencyKey,
            fingerprint: req.fingerprint
          }
        }, { session });

        const signatureLock = await acquireIdempotencySignature({
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
        }, { session });

        if (!signatureLock.acquired && signatureLock.signature?.webhookId !== job.jobId) {
          replayJob = await GitHubSyncJob.findOne({ jobId: signatureLock.signature.webhookId }).lean().session(session);
          return;
        }
      });
    } finally {
      await session.endSession();
    }

    if (replayJob) {
      const replayStatusCode = ['PENDING', 'IN_PROGRESS'].includes(replayJob.status) ? 409 : 200;
      return res.status(replayStatusCode).json({
        error: replayStatusCode === 409 ? 'SYNC_ALREADY_RUNNING' : undefined,
        job_id: replayJob.jobId,
        status: replayJob.status,
        message: replayStatusCode === 409
          ? 'Returning existing in-flight job (atomic idempotency)'
          : 'Returning existing completed job (atomic idempotency)',
        correlationId,
        externalRequestId,
        replay: true,
        result: replayJob.status === 'COMPLETED' ? replayJob.validationRecords : undefined
      });
    }

    // Additional lock check (legacy callers without idempotency key).
    const existingLock = await GitHubSyncJob.findOne({
      groupId,
      sprintId,
      status: 'IN_PROGRESS',
      jobId: { $ne: job.jobId }
    }).lean();
    if (existingLock) {
      return res.status(409).json({
        error: 'SYNC_ALREADY_RUNNING',
        message: `A GitHub sync is already in progress for group ${groupId} / sprint ${sprintId}`,
        jobId: existingLock.jobId,
        job_id: existingLock.jobId,
        source: 'github',
        correlationId,
        externalRequestId
      });
    } catch (createErr) {
      if (createErr?.code === 11000) {
        const existingLock = await GitHubSyncJob.findOne({
          groupId,
          sprintId,
          status: 'IN_PROGRESS',
        }).lean();
        return res.status(409).json({
          error: 'SYNC_ALREADY_RUNNING',
          message: `A GitHub sync is already in progress for group ${groupId} / sprint ${sprintId}`,
          job_id: existingLock?.jobId || null,
        });
      }
      throw createErr;
    }

    await createAuditLog({
      action: 'IDEMPOTENCY_KEY_VALIDATED',
      actorId,
      groupId,
      targetId: job.jobId,
      payload: {
        correlationId,
        externalRequestId,
        idempotencyKey: req.idempotencyKey,
        fingerprint: req.fingerprint
      }
    }).catch((err) => logError('Audit log failed for idempotency validation', {
      service_name: 'github_sync',
      correlationId,
      externalRequestId,
      groupId,
      sprintId,
      jobId: job?.jobId || null,
      error: err.message
    }));
    // ── Audit: sync initiated (non-fatal) ───────────────────────────────────
    try {
      await createAuditLog({
        action: 'GITHUB_SYNC_INITIATED',
        actorId,
        groupId,
        targetId: job.jobId,
        payload: {
          correlationId,
          externalRequestId,
          sprintId,
          jobId: job.jobId,
          idempotencyKey: req.idempotencyKey
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId,
      });
    } catch (auditErr) {
      logError('Audit log failed for sync initiated', {
        service_name: 'github_sync',
        correlationId,
        externalRequestId,
        groupId,
        sprintId,
        jobId: job?.jobId || null,
        error: auditErr.message
      });
    }

    // ── Respond 202 immediately (SprintSyncJobStatus — apispec2_7.yaml) ─────
    res.status(202).json({
      jobId: job.jobId,
      job_id: job.jobId,
      status: 'queued',
      source: 'github',
      message: 'GitHub sync job accepted. PR validation will run asynchronously.',
      correlationId,
      externalRequestId,
      idempotencyKey: req.idempotencyKey,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt ?? job.createdAt,
    });

    // =========================================================================
    // ISSUE #241: Step 4 — Fire async worker with correlationId
    // =========================================================================
    // setImmediate ensures the HTTP response is fully flushed before worker runs
    setImmediate(() => {
      try {
        githubSyncWorker(groupId, sprintId, job.jobId, correlationId, externalRequestId).catch((err) => {
          logError('Unhandled worker error from triggerGitHubSync', {
            service_name: 'github_sync',
            correlationId,
            externalRequestId,
            groupId,
            sprintId,
            jobId: job?.jobId || null,
            error: err.message
          });
        });
      } catch (setImmediateErr) {
        logError('setImmediate dispatch error in triggerGitHubSync', {
          service_name: 'github_sync',
          correlationId,
          externalRequestId,
          groupId,
          sprintId,
          jobId: job?.jobId || null,
          error: setImmediateErr.message
        });
      }
    });

  } catch (err) {
    if (err?.code === 11000) {
      const racingJob = await GitHubSyncJob.findOne({
        groupId,
        sprintId,
        status: { $in: ['PENDING', 'IN_PROGRESS'] },
      }).lean();
      return res.status(409).json({
        error: 'SYNC_ALREADY_RUNNING',
        message: `A GitHub sync is already in progress for group ${groupId} / sprint ${sprintId}`,
        jobId: racingJob?.jobId,
        job_id: racingJob?.jobId,
        source: 'github',
        correlationId,
        externalRequestId
      });
    }

    // Propagation from GitHubSyncError (pre-flight checks)
    if (err instanceof GitHubSyncError) {
      const statusMap = {
        400: { error: 'INVALID_GITHUB_CREDENTIALS' },
        404: { error: 'JIRA_DATA_MISSING' },
        502: { error: 'UPSTREAM_PROVIDER_ERROR' },
        504: { error: 'GATEWAY_TIMEOUT' },
      };
      const body = statusMap[err.status] || { error: 'INTERNAL_ERROR' };
      return res.status(err.status).json({ ...body, message: err.message, correlationId, externalRequestId });
    }
    logError('Unexpected error in triggerGitHubSync', {
      service_name: 'github_sync',
      correlationId,
      externalRequestId,
      groupId,
      sprintId,
      error: err.message
    });
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
      externalRequestId
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
 *
 * ISSUE #241: Enhanced response includes correlationId for tracing
 */
const getSyncJobStatus = async (req, res) => {
  if (!ensureSyncAccess(req, res)) return;
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
      jobId: job.jobId,
      job_id: job.jobId,
      status: toPublicStatus(job.status),
      source: 'github',
      mappedHttpStatus: mapJobToHttpStatus(job.status, job.errorCode),
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
      updatedAt: job.updatedAt,
    });
  } catch (err) {
    logError('Error in getSyncJobStatus', {
      service_name: 'github_sync',
      correlationId,
      externalRequestId: req.externalRequestId || null,
      groupId,
      sprintId,
      jobId,
      error: err.message
    });
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
  if (!ensureSyncAccess(req, res)) return;
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
      jobId: job.jobId,
      job_id: job.jobId,
      status: toPublicStatus(job.status),
      source: 'github',
      mappedHttpStatus: mapJobToHttpStatus(job.status, job.errorCode),
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
      updatedAt: job.updatedAt,
    });
  } catch (err) {
    logError('Error in getLatestSyncJob', {
      service_name: 'github_sync',
      correlationId,
      externalRequestId: req.externalRequestId || null,
      groupId,
      sprintId,
      error: err.message
    });
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId
    });
  }
};

const getSyncJobLogs = async (req, res) => {
  if (!ensureSyncAccess(req, res)) return;
  const { groupId, sprintId, jobId } = req.params;
  try {
    const job = await GitHubSyncJob.findOne({ jobId, groupId, sprintId }).lean();
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `Sync job ${jobId} not found for group ${groupId} / sprint ${sprintId}`,
      });
    }

    const terminal = job.status === 'COMPLETED' || job.status === 'FAILED';
    const stamp = job.completedAt || job.updatedAt || job.createdAt;

    const logs = [
      { level: 'info', at: job.createdAt, message: 'GitHub sync job created.' },
      job.startedAt ? { level: 'info', at: job.startedAt, message: 'GitHub sync worker started.' } : null,
    ];

    if (Array.isArray(job.validationRecords)) {
      logs.push({
        level: 'info',
        at: stamp,
        message: `Validation records processed: ${job.validationRecords.length}`,
      });
    }

    if (job.status === 'FAILED') {
      const detail = job.errorMessage || job.errorCode || 'GitHub sync failed.';
      logs.push({ level: 'error', at: stamp, message: detail });
    } else if (job.errorMessage) {
      logs.push({ level: 'warn', at: stamp, message: job.errorMessage });
    }

    if (terminal) {
      const merged =
        job.status === 'COMPLETED' && Array.isArray(job.validationRecords)
          ? job.validationRecords.filter((r) => r.mergeStatus === 'MERGED').length
          : null;
      const suffix = merged !== null ? ` (${merged} PR(s) merged).` : '.';
      logs.push({
        level: 'info',
        at: stamp,
        message: `GitHub sync finished with status ${toPublicStatus(job.status)}${suffix}`,
      });
    }

    const filtered = logs.filter(Boolean);

    return res.status(200).json({
      jobId: job.jobId,
      source: 'github',
      status: toPublicStatus(job.status),
      logs: filtered,
    });
  } catch (err) {
    console.error('[getSyncJobLogs] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { triggerGitHubSync, getSyncJobStatus, getLatestSyncJob, getSyncJobLogs };
