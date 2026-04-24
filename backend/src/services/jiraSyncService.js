'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const Group = require('../models/Group');
const SprintConfig = require('../models/SprintConfig');
const SprintIssue = require('../models/SprintIssue');
const JiraSyncJob = require('../models/JiraSyncJob');
const SyncErrorLog = require('../models/SyncErrorLog');
const { decrypt } = require('../utils/cryptoUtils');
const { createAuditLog } = require('./auditService');

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;

class JiraSyncError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'JiraSyncError';
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, maxAttempts = MAX_RETRY_ATTEMPTS) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const shouldRetry =
        err.code === 'ECONNABORTED' ||
        !status ||
        status === 502 ||
        status === 503 ||
        status === 504;

      if (!shouldRetry) {
        throw err;
      }

      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }

  throw lastError;
}

async function getJiraConfig(groupId) {
  const group = await Group.findOne({ groupId }).select('+jiraToken').lean();
  if (!group) {
    throw new JiraSyncError(404, 'GROUP_NOT_FOUND', `Group ${groupId} not found`);
  }

  if (!group.jiraUrl || !group.jiraUsername || !group.jiraToken || !group.projectKey) {
    throw new JiraSyncError(400, 'INVALID_JIRA_CONFIGURATION', 'JIRA integration is not configured for this group');
  }

  return {
    baseUrl: group.jiraUrl,
    email: group.jiraUsername,
    encryptedToken: group.jiraToken,
    projectKey: group.projectKey,
  };
}

async function getPublishedSprintConfig(groupId, sprintId) {
  const config = await SprintConfig.findOne({
    groupId,
    sprintId,
    configurationStatus: 'published',
    deadline: { $gte: new Date() },
  }).lean();

  if (!config) {
    throw new JiraSyncError(
      422,
      'SPRINT_CONFIG_NOT_PUBLISHED',
      `No published sprint configuration found for group ${groupId} / sprint ${sprintId}`
    );
  }

  if (!config.externalSprintKey) {
    throw new JiraSyncError(
      422,
      'SPRINT_CONFIG_INCOMPLETE',
      `Published sprint configuration for ${sprintId} is missing externalSprintKey`
    );
  }

  return config;
}

function createJiraAuthHeaders(email, token) {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function discoverStoryPointField(baseUrl, headers) {
  const response = await withRetry(() =>
    axios.get(`${baseUrl}/rest/api/3/field`, {
      headers,
      timeout: 8000,
    })
  );

  const matchingField = (response.data || []).find((field) => {
    const normalizedName = String(field?.name || '').trim().toLowerCase();
    return normalizedName === 'story points' || normalizedName === 'story point estimate';
  });

  if (!matchingField?.id) {
    throw new JiraSyncError(502, 'JIRA_STORY_POINTS_FIELD_NOT_FOUND', 'JIRA story points field could not be resolved');
  }

  return matchingField.id;
}

async function fetchSprintIssuesFromJira(config, sprintConfig) {
  const decryptedToken = decrypt(config.encryptedToken);
  const headers = createJiraAuthHeaders(config.email, decryptedToken);
  const storyPointFieldId = await discoverStoryPointField(config.baseUrl, headers);
  const jql = `project = "${config.projectKey}" AND sprint = "${sprintConfig.externalSprintKey}"`;
  const issues = [];
  let startAt = 0;
  let total = 0;

  do {
    const response = await withRetry(() =>
      axios.get(`${config.baseUrl}/rest/api/3/search`, {
        headers,
        timeout: 8000,
        params: {
          jql,
          startAt,
          maxResults: 100,
          fields: `summary,status,assignee,${storyPointFieldId}`,
        },
      })
    );

    const pageIssues = response.data?.issues || [];
    total = Number(response.data?.total || pageIssues.length);
    issues.push(...pageIssues);
    startAt += pageIssues.length;

    if (pageIssues.length === 0) {
      break;
    }
  } while (issues.length < total);

  return {
    issues,
    storyPointFieldId,
    jql,
  };
}

async function persistSprintIssues(groupId, sprintId, issues, storyPointFieldId) {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      if (issues.length === 0) {
        return;
      }

      const operations = issues.map((issue) => {
        const fields = issue.fields || {};
        const assignee = fields.assignee || {};

        return {
          updateOne: {
            filter: { groupId, sprintId, issueKey: issue.key },
            update: {
              $set: {
                storyPoints: Number(fields[storyPointFieldId] || 0),
                status: fields.status?.name || null,
                assigneeAccountId: assignee.accountId || null,
                assigneeDisplayName: assignee.displayName || null,
                rawIssue: issue,
                syncedAt: new Date(),
              },
              $setOnInsert: {
                groupId,
                sprintId,
                issueKey: issue.key,
              },
            },
            upsert: true,
          },
        };
      });

      await SprintIssue.bulkWrite(operations, { session });
    });

    return issues.length;
  } finally {
    await session.endSession();
  }
}

async function logSyncError(groupId, actorId, message) {
  await SyncErrorLog.create({
    service: 'jira',
    groupId,
    actorId,
    attempts: MAX_RETRY_ATTEMPTS,
    lastError: message,
  });
}

function classifyJiraFailure(err) {
  if (err instanceof JiraSyncError) {
    return err;
  }

  if (err.code === 'ECONNABORTED') {
    return new JiraSyncError(504, 'GATEWAY_TIMEOUT', 'JIRA API timed out after maximum retry attempts');
  }

  if (err.response?.status >= 500) {
    return new JiraSyncError(502, 'UPSTREAM_PROVIDER_ERROR', 'JIRA API returned an upstream error');
  }

  if (err.response?.status >= 400 && err.response?.status < 500) {
    return new JiraSyncError(502, 'UPSTREAM_PROVIDER_ERROR', 'JIRA API returned an invalid response');
  }

  return new JiraSyncError(504, 'GATEWAY_TIMEOUT', 'JIRA API failed after retry exhaustion');
}

async function jiraSyncWorker(groupId, sprintId, jobId) {
  const job = await JiraSyncJob.findOne({ jobId });
  if (!job) {
    return;
  }

  job.status = 'IN_PROGRESS';
  job.startedAt = new Date();
  await job.save();

  try {
    const config = await getJiraConfig(groupId);
    const sprintConfig = await getPublishedSprintConfig(groupId, sprintId);
    const { issues, storyPointFieldId, jql } = await fetchSprintIssuesFromJira(config, sprintConfig);
    const upserted = await persistSprintIssues(groupId, sprintId, issues, storyPointFieldId);

    job.status = 'COMPLETED';
    job.issuesProcessed = issues.length;
    job.issuesUpserted = upserted;
    job.completedAt = new Date();
    await job.save();

    try {
      await createAuditLog({
        action: 'JIRA_SYNC_COMPLETED',
        actorId: job.triggeredBy || 'system',
        groupId,
        targetId: jobId,
        payload: {
          sprintId,
          jobId,
          issuesProcessed: issues.length,
          issuesUpserted: upserted,
          externalSprintKey: sprintConfig.externalSprintKey,
          jql,
        },
      });
    } catch (auditErr) {
      console.error('[jiraSyncWorker] Audit log failed (non-fatal):', auditErr.message);
    }
  } catch (err) {
    const normalizedError = classifyJiraFailure(err);

    job.status = 'FAILED';
    job.completedAt = new Date();
    job.errorCode = normalizedError.code;
    job.errorMessage = normalizedError.message;
    await job.save();

    try {
      await logSyncError(groupId, job.triggeredBy || 'system', normalizedError.message);
    } catch (syncErr) {
      console.error('[jiraSyncWorker] SyncErrorLog write failed (non-fatal):', syncErr.message);
    }

    try {
      await createAuditLog({
        action: 'JIRA_SYNC_FAILED',
        actorId: job.triggeredBy || 'system',
        groupId,
        targetId: jobId,
        payload: {
          sprintId,
          jobId,
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
        },
      });
    } catch (auditErr) {
      console.error('[jiraSyncWorker] Audit log failed (non-fatal):', auditErr.message);
    }
  }
}

module.exports = {
  JiraSyncError,
  jiraSyncWorker,
  getJiraConfig,
  getPublishedSprintConfig,
};
