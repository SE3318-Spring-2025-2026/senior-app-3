const axios = require('axios');
const Group = require('../models/Group');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('../services/auditService');

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== req.user.userId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the group leader can configure GitHub' });
    }

    // f11: validate PAT against GitHub API (with retry)
    let orgData;
    try {
      await withRetry(() =>
        axios.get('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${pat.trim()}`, 'User-Agent': 'senior-app' },
          timeout: 5000,
        })
      );
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
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

    // f24: store config in D2
    group.githubPat = pat.trim();
    group.githubOrg = org_name.trim();
    group.githubOrgId = orgData.id;
    group.githubOrgName = orgData.name;
    group.githubRepoName = repo_name.trim();
    group.githubVisibility = visibility;
    group.githubRepoUrl = `https://github.com/${org_name.trim()}/${repo_name.trim()}`;
    group.githubLastSynced = new Date();
    await group.save();

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

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

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
      response.org = {
        id: group.githubOrgId,
        login: group.githubOrg,
        name: group.githubOrgName,
      };
      response.last_synced = group.githubLastSynced;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error('getGithub error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * POST /groups/:groupId/jira
 *
 * Process 2.7 — Validate JIRA credentials + project key and store config in D2.
 *
 * DFD flows:
 *   f13 — Team Leader → 2.7 (submit JIRA credentials)
 *   f14 — 2.7 → JIRA API (validate credentials + project)
 *   f15 — JIRA API → 2.7 (confirm binding)
 *   f25 — 2.7 → D2 (store validated JIRA config)
 *
 * Error codes:
 *   422 INVALID_JIRA_CREDENTIALS — JIRA rejects username/token (401/403)
 *   422 INVALID_PROJECT_KEY      — project key not found in JIRA (404)
 *   503 JIRA_API_UNAVAILABLE     — 3 consecutive timeouts/5xx errors
 */
const configureJira = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { jira_url, jira_username, jira_token, project_key } = req.body;

    if (!jira_url || typeof jira_url !== 'string' || !jira_url.trim()) {
      return res.status(400).json({ code: 'MISSING_JIRA_URL', message: 'jira_url is required' });
    }
    if (!jira_username || typeof jira_username !== 'string' || !jira_username.trim()) {
      return res.status(400).json({ code: 'MISSING_JIRA_USERNAME', message: 'jira_username is required' });
    }
    if (!jira_token || typeof jira_token !== 'string' || !jira_token.trim()) {
      return res.status(400).json({ code: 'MISSING_JIRA_TOKEN', message: 'jira_token is required' });
    }
    if (!project_key || typeof project_key !== 'string' || !project_key.trim()) {
      return res.status(400).json({ code: 'MISSING_PROJECT_KEY', message: 'project_key is required' });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== req.user.userId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the group leader can configure JIRA' });
    }

    const baseUrl = jira_url.trim().replace(/\/$/, '');
    const auth = Buffer.from(`${jira_username.trim()}:${jira_token.trim()}`).toString('base64');

    // f14: validate credentials against JIRA API
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
        return res.status(422).json({ code: 'INVALID_JIRA_CREDENTIALS', message: 'JIRA credentials are invalid' });
      }
      const jiraSyncErr1 = await SyncErrorLog.create({
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
          payload: {
            api_type: 'jira',
            retry_count: MAX_RETRY_ATTEMPTS,
            last_error: err.message,
            sync_error_id: jiraSyncErr1.errorId,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }
      return res.status(503).json({ code: 'JIRA_API_UNAVAILABLE', message: 'JIRA API unavailable after maximum retry attempts' });
    }

    // f15: validate project key
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
      const jiraSyncErr2 = await SyncErrorLog.create({
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
          payload: {
            api_type: 'jira',
            retry_count: MAX_RETRY_ATTEMPTS,
            last_error: err.message,
            sync_error_id: jiraSyncErr2.errorId,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }
      return res.status(503).json({ code: 'JIRA_API_UNAVAILABLE', message: 'JIRA API unavailable after maximum retry attempts' });
    }

    // f25: store config in D2
    group.jiraUrl = baseUrl;
    group.jiraUsername = jira_username.trim();
    group.jiraToken = jira_token.trim();
    group.projectKey = project_key.trim();
    group.jiraProject = projectData.name || project_key.trim();
    group.jiraBoardUrl = `${baseUrl}/jira/software/projects/${project_key.trim()}/boards`;
    await group.save();

    // Audit log: jira_integration_setup (non-fatal)
    try {
      await createAuditLog({
        action: 'jira_integration_setup',
        actorId: req.user.userId,
        targetId: groupId,
        groupId,
        payload: {
          status: 'success',
          jira_url: baseUrl,
          project_key: project_key.trim(),
          jira_board_url: group.jiraBoardUrl,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(201).json({
      jira_url: group.jiraUrl,
      jira_project: group.jiraProject,
      jira_project_key: group.projectKey,
      jira_board_url: group.jiraBoardUrl,
      validated: true,
    });
  } catch (err) {
    console.error('configureJira error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * GET /groups/:groupId/jira
 *
 * Returns the stored JIRA config for the group (token excluded).
 */
const getJira = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    const lastSyncError = await SyncErrorLog.findOne(
      { groupId, service: 'jira' },
      null,
      { sort: { createdAt: -1, _id: -1 } }
    );

    return res.status(200).json({
      group_id: groupId,
      jira_url: group.jiraUrl,
      jira_project: group.jiraProject,
      jira_project_key: group.projectKey,
      jira_board_url: group.jiraBoardUrl,
      validated: !!group.jiraUrl,
      last_sync_error: lastSyncError
        ? {
            error_id: lastSyncError.errorId,
            attempts: lastSyncError.attempts,
            last_error: lastSyncError.lastError,
            timestamp: lastSyncError.createdAt,
          }
        : null,
    });
  } catch (err) {
    console.error('getJira error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

module.exports = { configureGithub, getGithub, configureJira, getJira };
