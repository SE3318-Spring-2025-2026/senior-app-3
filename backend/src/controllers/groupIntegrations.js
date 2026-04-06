const axios = require('axios');
const Group = require('../models/Group');
const SyncErrorLog = require('../models/SyncErrorLog');

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Retry wrapper: calls fn up to maxAttempts times.
 * Returns the result on first success, or throws the last error.
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
 *   f10 — Team Leader → 2.6 (submit GitHub PAT + org)
 *   f11 — 2.6 → GitHub API (validate PAT, retrieve org data)
 *   f12 — GitHub API → 2.6 (return org data)
 *   f24 — 2.6 → D2 (store validated GitHub config)
 *
 * Error codes:
 *   422 INVALID_PAT         — GitHub API rejects the token (401/403)
 *   422 ORG_NOT_FOUND       — org does not exist or PAT lacks access
 *   503 GITHUB_API_UNAVAILABLE — 3 consecutive timeouts/5xx errors
 */
const configureGithub = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { pat, org } = req.body;

    if (!pat || typeof pat !== 'string' || !pat.trim()) {
      return res.status(400).json({ code: 'MISSING_PAT', message: 'pat is required' });
    }
    if (!org || typeof org !== 'string' || !org.trim()) {
      return res.status(400).json({ code: 'MISSING_ORG', message: 'org is required' });
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
      await SyncErrorLog.create({
        service: 'github',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      return res.status(503).json({ code: 'GITHUB_API_UNAVAILABLE', message: 'GitHub API unavailable after maximum retry attempts' });
    }

    // f12: retrieve org data
    try {
      const orgResponse = await withRetry(() =>
        axios.get(`https://api.github.com/orgs/${org.trim()}`, {
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
      await SyncErrorLog.create({
        service: 'github',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      return res.status(503).json({ code: 'GITHUB_API_UNAVAILABLE', message: 'GitHub API unavailable after maximum retry attempts' });
    }

    // f24: store config in D2
    group.githubPat = pat.trim();
    group.githubOrg = org.trim();
    await group.save();

    return res.status(200).json({
      github_org: group.githubOrg,
      validated: true,
      org_data: { login: orgData.login, id: orgData.id, name: orgData.name },
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
 */
const getGithub = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    return res.status(200).json({
      group_id: groupId,
      github_org: group.githubOrg,
      validated: !!group.githubOrg,
    });
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
      await SyncErrorLog.create({
        service: 'jira',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
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
      await SyncErrorLog.create({
        service: 'jira',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: err.message,
      });
      return res.status(503).json({ code: 'JIRA_API_UNAVAILABLE', message: 'JIRA API unavailable after maximum retry attempts' });
    }

    // f25: store config in D2
    group.jiraUrl = baseUrl;
    group.jiraUsername = jira_username.trim();
    group.jiraToken = jira_token.trim();
    group.projectKey = project_key.trim();
    group.jiraProject = projectData.name || project_key.trim();
    await group.save();

    return res.status(200).json({
      jira_url: group.jiraUrl,
      jira_project: group.jiraProject,
      project_key: group.projectKey,
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

    return res.status(200).json({
      group_id: groupId,
      jira_url: group.jiraUrl,
      jira_project: group.jiraProject,
      project_key: group.projectKey,
      validated: !!group.jiraUrl,
    });
  } catch (err) {
    console.error('getJira error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

module.exports = { configureGithub, getGithub, configureJira, getJira };
