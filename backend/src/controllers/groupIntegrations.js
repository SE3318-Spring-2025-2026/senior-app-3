const axios = require('axios');
const Group = require('../models/Group');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('../services/auditService');
const {
  getGroupOrThrow,
  overwriteGithubCredentials,
  overwriteJiraCredentials,
} = require('../services/integrationCoordinatorService');
const {
  REQUIRED_GITHUB_SCOPES,
  parseScopes,
  missingScopes,
  maskSecret,
  logSecurityAudit,
} = require('../services/integrationSecurityService');

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureLeader(group, userId) {
  if (group.leaderId !== userId) {
    const err = new Error('Only the group leader can configure this integration');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

function tryHandleKnownError(err, res) {
  if (err?.code === 'GROUP_NOT_FOUND') {
    res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    return true;
  }
  if (err?.code === 'FORBIDDEN') {
    res.status(403).json({ code: 'FORBIDDEN', message: err.message });
    return true;
  }
  return false;
}

/**
 * Retry wrapper: calls fn up to maxAttempts times with exponential back-off.
 * Returns the result on first success, or throws the last error.
 * 4xx client errors are not retried — they indicate business-rule failures.
 */
const withRetry = async (fn, maxAttempts = MAX_RETRY_ATTEMPTS) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Client errors (4xx) are not transient — fail immediately without retry
      if (err.response?.status >= 400 && err.response?.status < 500) {
        throw err;
      }
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
};

/**
 * POST /groups/:groupId/github
 *
 * Process 2.6 — Validate GitHub PAT + org and store config in D2.
 *
 * DFD flows:
 *   f10 — Team Leader → 2.6 (submit GitHub PAT + org + repo_name + visibility)
 *   f11 — 2.6 → GitHub API (validate PAT, retrieve org data)
 *   f12 — GitHub API → 2.6 (return org data)
 *   f24 — 2.6 → D2 (store validated GitHub config)
 *
 * Request body:
 *   - pat (required): GitHub Personal Access Token
 *   - org_name (required): GitHub organization name
 *   - repo_name (required): Repository name
 *   - visibility (optional): Visibility setting (private, public, internal); default: private
 *
 * Response (201 Created):
 *   - repo_url: Full GitHub repository URL
 *   - status: "success"
 *   - org_data: { id, login, name } from GitHub API
 *
 * Error codes:
 *   422 INVALID_PAT         — GitHub API rejects the token (401/403)
 *   422 ORG_NOT_FOUND       — org does not exist or PAT lacks access
 *   503 GITHUB_API_UNAVAILABLE — 3 consecutive timeouts/5xx errors
 */
const configureGithub = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { pat, org_name, repo_name, visibility = 'private' } = req.body;

    // Validate required fields
    if (!pat || typeof pat !== 'string' || !pat.trim()) {
      return res.status(400).json({ code: 'MISSING_PAT', message: 'pat is required' });
    }
    if (!org_name || typeof org_name !== 'string' || !org_name.trim()) {
      return res.status(400).json({ code: 'MISSING_ORG', message: 'org_name is required' });
    }
    if (!repo_name || typeof repo_name !== 'string' || !repo_name.trim()) {
      return res.status(400).json({ code: 'MISSING_REPO', message: 'repo_name is required' });
    }
    if (!['private', 'public', 'internal'].includes(visibility)) {
      return res.status(400).json({ code: 'INVALID_VISIBILITY', message: 'visibility must be one of: private, public, internal' });
    }

    const group = await getGroupOrThrow(groupId);
    ensureLeader(group, req.user.userId);

    // f11: validate PAT against GitHub API (with retry)
    let orgData;
    try {
      const githubUserResponse = await withRetry(() =>
        axios.get('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${pat.trim()}`, 'User-Agent': 'senior-app' },
          timeout: 5000,
        })
      );

      const grantedScopes = parseScopes(githubUserResponse.headers['x-oauth-scopes']);
      const missing = missingScopes(grantedScopes);
      if (missing.length > 0) {
        await logSecurityAudit({
          actorId: req.user.userId,
          groupId,
          targetId: groupId,
          provider: 'github',
          reason: 'insufficient_scopes',
          statusCode: 403,
          req,
        });
        return res.status(422).json({
          code: 'INSUFFICIENT_GITHUB_SCOPES',
          message: `GitHub PAT is missing minimum scopes: ${missing.join(', ')}`,
          required_scopes: REQUIRED_GITHUB_SCOPES,
        });
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        await logSecurityAudit({
          actorId: req.user.userId,
          groupId,
          targetId: groupId,
          provider: 'github',
          reason: 'unauthorized_token_use',
          statusCode: status,
          req,
        });
        return res.status(422).json({ code: 'INVALID_PAT', message: 'GitHub PAT is invalid or has insufficient permissions' });
      }
      // Network/timeout failures — log sync error
      const syncErr = await SyncErrorLog.create({
        service: 'github',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      try {
        await createAuditLog({
          action: 'sync_error',
          actorId: req.user.userId,
          groupId,
          payload: {
            api_type: 'github',
            retry_count: MAX_RETRY_ATTEMPTS,
            last_error: err.message,
            sync_error_id: syncErr.errorId,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }
      return res.status(503).json({ code: 'GITHUB_API_UNAVAILABLE', message: 'GitHub API unavailable after maximum retry attempts' });
    }

    // f12: retrieve org data
    try {
      const orgResponse = await withRetry(() =>
        axios.get(`https://api.github.com/orgs/${org_name.trim()}`, {
          headers: { Authorization: `Bearer ${pat.trim()}`, 'User-Agent': 'senior-app' },
          timeout: 5000,
        })
      );
      orgData = orgResponse.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        return res.status(422).json({ code: 'ORG_NOT_FOUND', message: 'GitHub organisation not found or PAT lacks access' });
      }
      const syncErr2 = await SyncErrorLog.create({
        service: 'github',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      try {
        await createAuditLog({
          action: 'sync_error',
          actorId: req.user.userId,
          groupId,
          payload: {
            api_type: 'github',
            retry_count: MAX_RETRY_ATTEMPTS,
            last_error: err.message,
            sync_error_id: syncErr2.errorId,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }
      return res.status(503).json({ code: 'GITHUB_API_UNAVAILABLE', message: 'GitHub API unavailable after maximum retry attempts' });
    }

    // f24: store config in D2 (PAT stored encrypted + rotated)
    await overwriteGithubCredentials({
      group,
      pat: pat.trim(),
      orgName: org_name.trim(),
      orgData,
      repoName: repo_name.trim(),
      visibility,
      actorId: req.user.userId,
      req,
    });

    // Audit log: github_integration_setup (non-fatal)
    try {
      await createAuditLog({
        action: 'github_integration_setup',
        actorId: req.user.userId,
        targetId: groupId,
        groupId,
        payload: {
          status: 'success',
          org_name: org_name.trim(),
          repo_name: repo_name.trim(),
          visibility: visibility,
          github_repo_url: group.githubRepoUrl,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(201).json({
      repo_url: group.githubRepoUrl,
      status: 'created',
      org_data: { 
        id: orgData.id, 
        login: orgData.login, 
        name: orgData.name 
      },
    });
  } catch (err) {
    if (tryHandleKnownError(err, res)) return;
    console.error('configureGithub error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * GET /groups/:groupId/github
 *
 * Returns the stored GitHub config for the group (PAT excluded).
 * 
 * DFD flow: 2.6 → Student (confirmation status check)
 * 
 * Response format:
 *   - group_id: Group identifier
 *   - github_org: Stored organization name (legacy field)
 *   - validated: Boolean indicating if GitHub integration is set up (legacy field)
 *   - connected: Boolean indicating if GitHub integration is active
 *   - repo_url: GitHub repository URL (only if connected)
 *   - org: Organization data { id, login, name } (only if connected)
 *   - last_synced: Timestamp of last successful validation (only if connected)
 *   - last_sync_error: Error information if last attempt failed
 */
const getGithub = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await getGroupOrThrow(groupId);

    // Check if GitHub integration is connected
    const isConnected = !!(group.githubOrg && group.githubPat && group.githubRepoUrl);

    const lastSyncError = await SyncErrorLog.findOne(
      { groupId, service: 'github' },
      null,
      { sort: { createdAt: -1, _id: -1 } }
    );

    // Build response with core confirmation fields
    const response = {
      group_id: groupId,
      github_org: group.githubOrg,
      validated: !!group.githubOrg,
      // New status fields (flow f24: 2.6 → Student)
      connected: isConnected,
      last_sync_error: lastSyncError
        ? {
            error_id: lastSyncError.errorId,
            attempts: lastSyncError.attempts,
            last_error: lastSyncError.lastError,
            timestamp: lastSyncError.createdAt,
          }
        : null,
    };

    // Include confirmation data only if successfully connected
    if (isConnected) {
      response.repo_url = group.githubRepoUrl;
      response.token_masked = maskSecret(null);
      response.required_scopes = REQUIRED_GITHUB_SCOPES;
      response.org = {
        id: group.githubOrgId,
        login: group.githubOrg,
        name: group.githubOrgName,
      };
      response.last_synced = group.githubLastSynced;
    }

    return res.status(200).json(response);
  } catch (err) {
    if (tryHandleKnownError(err, res)) return;
    console.error('getGithub error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * POST /groups/:groupId/jira
 *
 * Process 2.7 — Validate JIRA credentials + project key and store binding in D2.
 * JIRA usage is strictly scoped to story point retrieval only.
 *
 * DFD flows:
 *   f13 — Team Leader → 2.7 (submit host, email, api_token, project_key)
 *   f14 — 2.7 → JIRA API (validate credentials, fetch project binding)
 *   f15 — JIRA API → 2.7 (binding confirmation: project_id, board_url)
 *   f25 — 2.7 → D2 (store binding confirmation)
 *
 * Request body:
 *   host        (required) — JIRA instance base URL
 *   email       (required) — JIRA account email
 *   api_token   (required) — JIRA API token
 *   project_key (required) — JIRA project key
 *
 * Response (201 Created):
 *   project_id  — JIRA project ID
 *   project_key — confirmed project key
 *   binding     — 'confirmed'
 *   board_url   — URL to the JIRA board
 *
 * Error codes:
 *   422 INVALID_JIRA_CREDENTIALS — JIRA rejects email/token (401/403)
 *   422 INVALID_PROJECT_KEY      — project key not found in JIRA (404)
 *   503 JIRA_API_UNAVAILABLE     — 3 consecutive timeouts/5xx errors
 */
const configureJira = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { host, email, api_token, project_key } = req.body;

    if (!host || typeof host !== 'string' || !host.trim()) {
      return res.status(400).json({ code: 'MISSING_HOST', message: 'host is required' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ code: 'MISSING_EMAIL', message: 'email is required' });
    }
    if (!api_token || typeof api_token !== 'string' || !api_token.trim()) {
      return res.status(400).json({ code: 'MISSING_API_TOKEN', message: 'api_token is required' });
    }
    if (!project_key || typeof project_key !== 'string' || !project_key.trim()) {
      return res.status(400).json({ code: 'MISSING_PROJECT_KEY', message: 'project_key is required' });
    }

    const group = await getGroupOrThrow(groupId);
    ensureLeader(group, req.user.userId);

    const baseUrl = host.trim().replace(/\/$/, '');
    const auth = Buffer.from(`${email.trim()}:${api_token.trim()}`).toString('base64');

    // f14: validate credentials against JIRA API (with retry)
    try {
      await withRetry(() =>
        axios.get(`${baseUrl}/rest/api/3/myself`, {
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          timeout: 5000,
        })
      );
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        await logSecurityAudit({
          actorId: req.user.userId,
          groupId,
          targetId: groupId,
          provider: 'jira',
          reason: 'unauthorized_token_use',
          statusCode: status,
          req,
        });
        return res.status(422).json({
          code: 'INVALID_JIRA_CREDENTIALS',
          message: 'JIRA credentials are invalid or have insufficient permissions',
        });
      }
      const syncErr = await SyncErrorLog.create({
        service: 'jira',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      try {
        await createAuditLog({
          action: 'sync_error',
          actorId: req.user.userId,
          groupId,
          payload: { api_type: 'jira', retry_count: MAX_RETRY_ATTEMPTS, last_error: err.message, sync_error_id: syncErr.errorId },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }
      return res.status(503).json({ code: 'JIRA_API_UNAVAILABLE', message: 'JIRA API unavailable after maximum retry attempts' });
    }

    // f15: fetch project binding confirmation from JIRA API (with retry)
    let projectData;
    try {
      const projResponse = await withRetry(() =>
        axios.get(`${baseUrl}/rest/api/3/project/${project_key.trim()}`, {
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          timeout: 5000,
        })
      );
      projectData = projResponse.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        return res.status(422).json({ code: 'INVALID_PROJECT_KEY', message: 'JIRA project key not found' });
      }
      const syncErr2 = await SyncErrorLog.create({
        service: 'jira',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      try {
        await createAuditLog({
          action: 'sync_error',
          actorId: req.user.userId,
          groupId,
          payload: { api_type: 'jira', retry_count: MAX_RETRY_ATTEMPTS, last_error: err.message, sync_error_id: syncErr2.errorId },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }
      return res.status(503).json({ code: 'JIRA_API_UNAVAILABLE', message: 'JIRA API unavailable after maximum retry attempts' });
    }

    // f25: store binding confirmation in D2 (credential overwrite)
    await overwriteJiraCredentials({
      group,
      baseUrl,
      email: email.trim(),
      apiToken: api_token.trim(),
      projectKey: project_key.trim(),
      projectData,
      actorId: req.user.userId,
      req,
    });

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: 'jira_integration_setup',
        actorId: req.user.userId,
        targetId: groupId,
        groupId,
        payload: {
          binding: 'confirmed',
          project_key: project_key.trim(),
          project_id: group.jiraProjectId,
          board_url: group.jiraBoardUrl,
          story_point_only: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(201).json({
      project_id: group.jiraProjectId,
      project_key: group.projectKey,
      binding: 'confirmed',
      board_url: group.jiraBoardUrl,
    });
  } catch (err) {
    if (tryHandleKnownError(err, res)) return;
    console.error('configureJira error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * GET /groups/:groupId/jira
 *
 * Returns the stored JIRA integration state for the group (token excluded).
 *
 * DFD flow: f25 (2.7 → Student) — confirmation status check
 *
 * Response:
 *   connected    — true when project binding is complete
 *   project_key  — JIRA project key (only if connected)
 *   board_url    — JIRA board URL (only if connected)
 *   last_sync_error — most recent sync failure, if any
 */
const getJira = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await getGroupOrThrow(groupId);

    const isConnected = !!(group.jiraUrl && group.projectKey && group.jiraBoardUrl);

    const lastSyncError = await SyncErrorLog.findOne(
      { groupId, service: 'jira' },
      null,
      { sort: { createdAt: -1, _id: -1 } }
    );

    const response = {
      connected: isConnected,
      last_sync_error: lastSyncError
        ? {
            error_id: lastSyncError.errorId,
            attempts: lastSyncError.attempts,
            last_error: lastSyncError.lastError,
            timestamp: lastSyncError.createdAt,
          }
        : null,
    };

    if (isConnected) {
      response.project_key = group.projectKey;
      response.board_url = group.jiraBoardUrl;
      response.token_masked = maskSecret(null);
    }

    return res.status(200).json(response);
  } catch (err) {
    if (tryHandleKnownError(err, res)) return;
    console.error('getJira error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

module.exports = { configureGithub, getGithub, configureJira, getJira };
