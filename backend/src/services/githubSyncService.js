'use strict';

/**
 * githubSyncService.js — Process 7.2
 *
 * Async bridge between GitHub and the internal data store (D6).
 *
 * Responsibilities:
 *   1. Read GitHub PAT + repo binding from D2 (Group document)
 *   2. Read sprint issue keys from D6 (SprintRecord + ContributionRecords)
 *   3. For each issue, retrieve the linked PR from GitHub API
 *   4. Map GitHub merge_state → internal merge_status (MERGED | NOT_MERGED | UNKNOWN)
 *   5. Persist validation results to D6 (GitHubSyncJob.validationRecords)
 *   6. Release the concurrency lock by marking the job COMPLETED or FAILED
 *
 * Retries:
 *   GitHub 5xx errors → exponential back-off (up to MAX_RETRY_ATTEMPTS attempts)
 *   GitHub 4xx errors → treated as business-rule failures (no retry)
 *
 * DFD flows:
 *   f30 — Trigger  : Controller → githubSyncWorker(groupId, sprintId, jobId)
 *   f31 — Read D2  : D2.get_config(groupId) → group.githubPat, group.githubRepoUrl
 *   f32 — Read D6  : D6.get_sprint_issues(sprintId) → SprintRecord.deliverableRefs + ContributionRecords
 *   f33 — GitHub   : GET /repos/:owner/:repo/pulls?head=:branch (per issue)
 *   f34 — Write D6 : GitHubSyncJob.validationRecords ← merge_status
 *   f35 — Release  : GitHubSyncJob.status ← COMPLETED | FAILED
 */

const axios = require('axios');
const Group = require('../models/Group');
const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');
const GitHubSyncJob = require('../models/GitHubSyncJob');
const SprintIssue = require('../models/SprintIssue');
const { createAuditLog } = require('./auditService');
const { decrypt } = require('../utils/cryptoUtils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200; // 200 → 400 → 800 ms

// GitHub merge state → internal enum
const MERGE_STATE_MAP = {
  // PR is merged
  merged: 'MERGED',
  // PR is open / closed but not merged
  clean: 'NOT_MERGED',
  unstable: 'NOT_MERGED',
  has_hooks: 'NOT_MERGED',
  behind: 'NOT_MERGED',
  blocked: 'NOT_MERGED',
  draft: 'NOT_MERGED',
  closed: 'NOT_MERGED',
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * withRetry — calls fn up to maxAttempts times with exponential back-off + jitter.
 * 4xx client errors are NOT retried (they indicate a business-rule failure).
 * Throws the last error after exhausting attempts.
 *
 * @param {()=>Promise<any>} fn
 * @param {number} maxAttempts
 */
async function withRetry(fn, maxAttempts = MAX_RETRY_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Client errors (4xx) → non-transient, fail immediately
      if (err.response?.status >= 400 && err.response?.status < 500) {
        throw err;
      }
      lastError = err;
      if (attempt < maxAttempts) {
        const exp = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 100);
        await sleep(exp + jitter);
      }
    }
  }
  throw lastError;
}

/**
 * determineMergeStatus — map a GitHub pull_request object to our internal enum.
 *
 * Handles three cases:
 *   • pr is null/undefined → 'UNKNOWN'
 *   • pr.merged === true   → 'MERGED'
 *   • Otherwise            → use MERGE_STATE_MAP on pr.merge_state, default 'UNKNOWN'
 */
function determineMergeStatus(pr) {
  if (!pr) return 'UNKNOWN';
  if (pr.merged === true || pr.merged_at) return 'MERGED';
  const mapped = MERGE_STATE_MAP[pr.merge_state];
  return mapped || 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// D2 accessor — fetch GitHub config from Group document
// ---------------------------------------------------------------------------

/**
 * getGitHubConfig(groupId) — reads D2
 *
 * @returns {{ encryptedPat: string, owner: string, repo: string, repoUrl: string }}
 * @throws {GitHubSyncError} with code INVALID_GITHUB_CREDENTIALS if not configured
 */
async function getGitHubConfig(groupId) {
  const group = await Group.findOne({ groupId }).lean();
  if (!group) {
    throw new GitHubSyncError(400, 'INVALID_GITHUB_CREDENTIALS', `Group ${groupId} not found`);
  }
  if (!group.githubPat || !group.githubOrg || !group.githubRepoName) {
    throw new GitHubSyncError(
      400,
      'INVALID_GITHUB_CREDENTIALS',
      'GitHub integration is not configured for this group'
    );
  }
  return {
    encryptedPat: group.githubPat, // Defer decryption until request level
    owner: group.githubOrg,
    repo: group.githubRepoName,
    repoUrl: group.githubRepoUrl,
  };
}

// ---------------------------------------------------------------------------
// D6 accessor — fetch issue keys for the sprint
// ---------------------------------------------------------------------------

/**
 * getSprintIssues(sprintId, groupId) — reads D6
 *
 * Aggregates issue keys from:
 *   1. SprintRecord.deliverableRefs (deliverable IDs act as issue keys here)
 *   2. ContributionRecord entries (one per student — represents a work item)
 *
 * Returns an array of { key: string, prLink: string|null, source: string, studentId?: string }.
 * prLink is derived from D6 metadata or falls back to branch-name convention.
 *
 * @returns {Array<{ key: string, prLink: string|null }>}
 * @throws {GitHubSyncError} 404 JIRA_DATA_MISSING if D6 is empty for this sprint
 */
async function getSprintIssues(sprintId, groupId) {
  const sprintIssues = await SprintIssue.find({ sprintId, groupId }).lean();
  const sprintRecord = await SprintRecord.findOne({ sprintId, groupId }).lean();
  const contributions = await ContributionRecord.find({ sprintId, groupId }).lean();

  const issues = [];

  // Source 0: canonical SprintIssue rows from Process 7.1
  for (const sprintIssue of sprintIssues) {
    issues.push({
      key: sprintIssue.issueKey,
      prLink: null,
      source: 'sprint_issue',
    });
  }

  // Source 1: deliverable refs from SprintRecord
  if (sprintRecord?.deliverableRefs?.length) {
    for (const ref of sprintRecord.deliverableRefs) {
      const alreadyAdded = issues.some((issue) => issue.key === ref.deliverableId);
      if (!alreadyAdded) {
        issues.push({
          key: ref.deliverableId,
          prLink: null, // will be resolved by branch pattern
          source: 'deliverable_ref',
        });
      }
    }
  }

  // Source 2: ContributionRecord entries (unique student work items)
  for (const contrib of contributions) {
    const studentKeys =
      Array.isArray(contrib.jiraIssueKeys) && contrib.jiraIssueKeys.length > 0
        ? contrib.jiraIssueKeys
        : contrib.jiraIssueKey
          ? [contrib.jiraIssueKey]
          : [`${sprintId}-${contrib.studentId}`];

    for (const key of studentKeys) {
      const alreadyAdded = issues.some((i) => i.key === key);
      if (!alreadyAdded) {
        issues.push({
          key,
          prLink: null,
          source: 'contribution_record',
          studentId: contrib.studentId,
        });
      }
    }
  }

  if (issues.length === 0) {
    throw new GitHubSyncError(
      404,
      'JIRA_DATA_MISSING',
      `No issues found in D6 for sprint ${sprintId}`
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// GitHub API accessor — find PR for an issue key
// ---------------------------------------------------------------------------

/**
 * getPullRequestForIssue(issue, config) — calls GitHub API
 *
 * Looks up open/closed PRs whose head branch matches the conventional pattern
 * "{issueKey}" or "feature/{issueKey}" or "fix/{issueKey}".
 * Returns the first matching PR object, or null if none found.
 *
 * @param {{ key: string, prLink: string|null }} issue
 * @param {{ encryptedPat: string, owner: string, repo: string }} config
 * @returns {Promise<Object|null>}
 */
async function getPullRequestForIssue(issue, config) {
  const { encryptedPat, owner, repo } = config;
  
  // FIX E: Decrypt PAT only at request level
  let pat;
  try {
    pat = decrypt(encryptedPat);
  } catch (err) {
    throw new GitHubSyncError(400, 'INVALID_GITHUB_CREDENTIALS', 'Failed to decrypt GitHub PAT');
  }

  const headers = {
    Authorization: `Bearer ${pat}`,
    'User-Agent': 'senior-app-github-sync',
    Accept: 'application/vnd.github+json',
  };

  // If D6 carries a direct PR URL, fetch it directly
  if (issue.prLink && issue.prLink.includes('/pulls/')) {
    const prNumber = issue.prLink.split('/pulls/')[1];
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
    try {
      const res = await withRetry(() => axios.get(url, { headers, timeout: 8000 }));
      return res.data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      // Do not log token or token-derived values (Zero-Trust logging)
      console.error(`[getPullRequestForIssue] API error for PR ${prNumber}:`, err.message);
      throw err;
    }
  }

  // Fallback: search by branch name convention
  const branchPatterns = [
    issue.key,
    `feature/${issue.key}`,
    `fix/${issue.key}`,
    `bugfix/${issue.key}`,
  ];

  for (const branch of branchPatterns) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
    try {
      const res = await withRetry(
        () =>
          axios.get(url, {
            headers,
            timeout: 8000,
            params: {
              state: 'all',
              head: `${owner}:${branch}`,
              per_page: 1,
            },
          }),
        MAX_RETRY_ATTEMPTS
      );
      if (res.data?.length > 0) {
        return res.data[0];
      }
    } catch (err) {
      // 422 = invalid branch ref format — skip, not a real error
      if (err.response?.status === 422) continue;
      // Do not log token or token-derived values (Zero-Trust logging)
      console.error(`[getPullRequestForIssue] API error for branch ${branch}:`, err.message);
      throw err;
    }
  }

  return null; // No PR found for this issue
}

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

class GitHubSyncError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'GitHubSyncError';
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Main async worker
// ---------------------------------------------------------------------------

/**
 * githubSyncWorker(groupId, sprintId, jobId) — Process 7.2 core
 *
 * Runs asynchronously after the HTTP 202 response has been sent.
 * Reads D2 + D6, hits GitHub API, writes results back to D6,
 * then releases the concurrency lock.
 *
 * All errors are caught — the job is marked FAILED and the lock is released
 * so a subsequent sync can be triggered.
 *
 * @param {string} groupId
 * @param {string} sprintId
 * @param {string} jobId  — GitHubSyncJob.jobId (also the lock key)
 */
async function githubSyncWorker(groupId, sprintId, jobId) {
  const job = await GitHubSyncJob.findOne({ jobId });
  if (!job) {
    console.error(`[githubSyncWorker] Job ${jobId} not found — aborting`);
    return;
  }

  job.status = 'IN_PROGRESS';
  job.startedAt = new Date();
  await job.save();

  try {
    // ── f31: Read D2 — GitHub config ────────────────────────────────────────
    const config = await getGitHubConfig(groupId);

    // ── f32: Read D6 — Sprint issues ────────────────────────────────────────
    const issues = await getSprintIssues(sprintId, groupId);

    // ── f33 + f34: Per-issue GitHub API call + D6 persistence ───────────────
    const validationRecords = [];
    let upstreamErrorCount = 0;
    let timeoutErrorCount = 0;

    for (const issue of issues) {
      let pr = null;
      let mergeStatus = 'UNKNOWN';
      let errorNote = null;

      try {
        pr = await getPullRequestForIssue(issue, config);
        mergeStatus = determineMergeStatus(pr);
      } catch (err) {
        // Upstream errors after retries → log but continue processing other issues
        console.error(`[githubSyncWorker] PR lookup failed for issue ${issue.key}:`, err.message);
        errorNote = err.message;

        // Classify critical upstream errors
        if (err.code === 'ECONNABORTED') {
          timeoutErrorCount++;
          upstreamErrorCount++;
        } else if (err.response?.status >= 500) {
          upstreamErrorCount++;
        }
      }

      validationRecords.push({
        issueKey: issue.key,
        prId: pr ? String(pr.number) : null,
        prUrl: pr ? pr.html_url : null,
        mergeStatus,
        lastValidated: new Date(),
        rawState: pr ? (pr.merged ? 'merged' : pr.merge_state) : (errorNote || 'not_found'),
      });
    }

    // Persist all records
    job.validationRecords = validationRecords;

    // ── Job Status Classification ──────────────────────────────────────────
    // If more than 50% of issues failed due to 5xx/timeout, fail the whole job
    if (issues.length > 0 && upstreamErrorCount / issues.length > 0.5) {
      job.status = 'FAILED';
      if (timeoutErrorCount > 0) {
        job.errorCode = 'GATEWAY_TIMEOUT';
        job.errorMessage = `GitHub API timed out for ${timeoutErrorCount} issue lookups.`;
      } else {
        job.errorCode = 'UPSTREAM_PROVIDER_ERROR';
        job.errorMessage = `GitHub API returned consistent errors for ${upstreamErrorCount} issues. Check GitHub status.`;
      }
    } else {
      job.status = 'COMPLETED';
    }

    job.completedAt = new Date();

    // ── f35: Release lock ────────────────────────────────────────────────────
    await job.save();

    // Audit (non-fatal)
    try {
      await createAuditLog({
        action: 'GITHUB_SYNC_COMPLETED',
        actorId: job.triggeredBy || 'system',
        groupId,
        targetId: jobId,
        payload: {
          sprintId,
          jobId,
          issuesProcessed: validationRecords.length,
          mergedCount: validationRecords.filter((r) => r.mergeStatus === 'MERGED').length,
          notMergedCount: validationRecords.filter((r) => r.mergeStatus === 'NOT_MERGED').length,
          unknownCount: validationRecords.filter((r) => r.mergeStatus === 'UNKNOWN').length,
        },
      });
    } catch (auditErr) {
      console.error('[githubSyncWorker] Audit log failed (non-fatal):', auditErr.message);
    }

  } catch (err) {
    // ── Fatal worker error — release lock and record failure ─────────────────
    console.error(`[githubSyncWorker] Fatal error for job ${jobId}:`, err);

    try {
      job.status = 'FAILED';
      job.completedAt = new Date();
      job.errorCode = err.code || 'WORKER_ERROR';
      job.errorMessage = err.message || 'Unknown error during GitHub sync';
      await job.save();
    } catch (saveErr) {
      console.error('[githubSyncWorker] Failed to mark job as FAILED:', saveErr.message);
    }

    // Audit failure (non-fatal)
    try {
      await createAuditLog({
        action: 'GITHUB_SYNC_FAILED',
        actorId: job.triggeredBy || 'system',
        groupId,
        targetId: jobId,
        payload: {
          sprintId,
          jobId,
          errorCode: err.code || 'WORKER_ERROR',
          errorMessage: err.message,
        },
      });
    } catch (auditErr) {
      console.error('[githubSyncWorker] Audit log failed (non-fatal):', auditErr.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  githubSyncWorker,
  determineMergeStatus,
  getGitHubConfig,
  getSprintIssues,
  GitHubSyncError,
};
