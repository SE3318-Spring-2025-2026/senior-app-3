'use strict';

const axios = require('axios');
const Group = require('../models/Group');
const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');
const SyncJob = require('../models/SyncJob');
const GitHubSyncJob = require('../models/GitHubSyncJob');
const User = require('../models/User');
const { decrypt } = require('../utils/cryptoUtils');

const toPublicStatus = (status) => {
  if (status === 'PENDING') return 'queued';
  if (status === 'IN_PROGRESS') return 'running';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'queued';
};

const toHttpStatus = (status) => {
  if (status === 'COMPLETED') return 200;
  if (status === 'FAILED') return 500;
  return 202;
};

const mapJobResponse = (job) => ({
  jobId: job.jobId,
  status: toPublicStatus(job.status),
  source: job.source,
  message: job.message,
  groupId: job.groupId,
  sprintId: job.sprintId,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  errorCode: job.errorCode,
  errorMessage: job.errorMessage,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  mappedHttpStatus: toHttpStatus(job.status),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async (fn, maxAttempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const isClientError = status >= 400 && status < 500;
      if (isClientError && status !== 429) {
        throw error;
      }
      if (attempt < maxAttempts) {
        await sleep(200 * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
};

const inferStoryPoints = (issue = {}) => {
  const fields = issue.fields || {};
  const directCandidates = ['storyPoints', 'story_point', 'story_points'];
  for (const candidate of directCandidates) {
    const value = Number(fields[candidate]);
    if (Number.isFinite(value)) return value;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!key.toLowerCase().includes('customfield')) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && key.toLowerCase().includes('story')) {
      return numeric;
    }
  }
  return 0;
};

const fetchJiraIssues = async ({ group, sprintKey, sprintId }) => {
  const baseUrl = String(group.jiraUrl || '').replace(/\/$/, '');
  const jiraToken = decrypt(group.jiraToken);
  const authToken = Buffer.from(`${group.jiraUsername}:${jiraToken}`).toString('base64');

  const headers = {
    Authorization: `Basic ${authToken}`,
    'Content-Type': 'application/json',
  };

  const jqlCandidates = [
    `project = "${group.projectKey}" AND sprint = "${sprintKey || sprintId}"`,
    `project = "${group.projectKey}" AND sprint = ${sprintKey || sprintId}`,
    `project = "${group.projectKey}" AND sprint in openSprints()`,
  ];

  for (const jql of jqlCandidates) {
    try {
      const response = await withRetry(() =>
        axios.get(`${baseUrl}/rest/api/3/search`, {
          headers,
          timeout: 8000,
          params: {
            jql,
            maxResults: 100,
            fields: '*all',
          },
        })
      );
      if (Array.isArray(response.data?.issues) && response.data.issues.length > 0) {
        return response.data.issues;
      }
    } catch (error) {
      if (error?.response?.status === 400) {
        continue;
      }
      throw error;
    }
  }

  return [];
};

const resolveAssigneeUserId = ({ issue, acceptedMemberIds, usersByEmail }) => {
  const assignee = issue?.fields?.assignee;
  if (!assignee) return null;

  // 1) If JIRA accountId already matches an internal userId, use it.
  const accountId = assignee.accountId ? String(assignee.accountId) : null;
  if (accountId && acceptedMemberIds.has(accountId)) {
    return accountId;
  }

  // 2) Fallback to email match when available.
  const email = assignee.emailAddress ? String(assignee.emailAddress).trim().toLowerCase() : null;
  if (email && usersByEmail.has(email)) {
    return usersByEmail.get(email);
  }

  return null;
};

const runJiraSyncWorker = async ({ jobId, groupId, sprintId, sprintKey }) => {
  const job = await SyncJob.findOne({ jobId });
  if (!job) return;

  try {
    job.status = 'IN_PROGRESS';
    job.startedAt = new Date();
    job.message = 'JIRA synchronization is running.';
    await job.save();

    const group = await Group.findOne({ groupId }).lean();
    if (!group) {
      throw Object.assign(new Error(`Group ${groupId} not found.`), { code: 'GROUP_NOT_FOUND' });
    }

    if (!group.jiraUrl || !group.jiraUsername || !group.jiraToken || !group.projectKey) {
      throw Object.assign(new Error('JIRA integration credentials are missing.'), {
        code: 'INVALID_JIRA_CONFIGURATION',
      });
    }

    const issues = await fetchJiraIssues({ group, sprintKey, sprintId });

    const deliverableRefs = issues.map((issue) => ({
      deliverableId: issue.key,
      // SprintRecord schema has fixed enum; we keep all imported JIRA issues under this bucket.
      type: 'demonstration',
      submittedAt: new Date(issue.fields?.updated || issue.fields?.created || Date.now()),
    }));

    await SprintRecord.findOneAndUpdate(
      { groupId, sprintId },
      {
        $set: {
          status: 'in_progress',
          deliverableRefs,
        },
        $setOnInsert: {
          groupId,
          sprintId,
        },
      },
      { upsert: true, new: true }
    );

    const acceptedMembers = Array.isArray(group.members)
      ? group.members.filter((member) => member.status === 'accepted')
      : [];
    const acceptedMemberIds = new Set(acceptedMembers.map((member) => member.userId));
    const memberUsers = await User.find(
      { userId: { $in: Array.from(acceptedMemberIds) } },
      { userId: 1, email: 1 }
    ).lean();
    const usersByEmail = new Map(
      memberUsers
        .filter((user) => Boolean(user.email))
        .map((user) => [String(user.email).trim().toLowerCase(), user.userId])
    );

    let unmappedAssigneeCount = 0;
    const aggregatedByStudent = new Map();

    // Build deterministic per-student totals from current JIRA snapshot.
    for (const issue of issues) {
      const assigneeUserId = resolveAssigneeUserId({
        issue,
        acceptedMemberIds,
        usersByEmail,
      });
      if (!assigneeUserId) {
        unmappedAssigneeCount += 1;
        continue;
      }

      const storyPoints = inferStoryPoints(issue);
      const bucket =
        aggregatedByStudent.get(assigneeUserId) || {
          issueKeys: [],
          storyPointsAssigned: 0,
          storyPointsCompleted: 0,
          issuesResolved: 0,
        };

      bucket.issueKeys.push(issue.key);
      bucket.storyPointsAssigned += storyPoints;
      bucket.storyPointsCompleted += storyPoints;
      bucket.issuesResolved += 1;
      aggregatedByStudent.set(assigneeUserId, bucket);
    }

    const existingRecords = await ContributionRecord.find({ groupId, sprintId }).lean();
    const existingByStudent = new Map(existingRecords.map((record) => [record.studentId, record]));

    // Idempotent write: set absolute values for each accepted member.
    for (const studentId of acceptedMemberIds) {
      const aggregate = aggregatedByStudent.get(studentId) || {
        issueKeys: [],
        storyPointsAssigned: 0,
        storyPointsCompleted: 0,
        issuesResolved: 0,
      };
      const existing = existingByStudent.get(studentId);
      if (!existing) {
        await ContributionRecord.create({
          groupId,
          sprintId,
          studentId,
          jiraIssueKeys: aggregate.issueKeys,
          storyPointsAssigned: aggregate.storyPointsAssigned,
          storyPointsCompleted: aggregate.storyPointsCompleted,
          issuesResolved: aggregate.issuesResolved,
          lastUpdatedAt: new Date(),
        });
        continue;
      }

      await ContributionRecord.updateOne(
        { contributionRecordId: existing.contributionRecordId },
        {
          $set: {
            jiraIssueKeys: aggregate.issueKeys,
            storyPointsAssigned: aggregate.storyPointsAssigned,
            storyPointsCompleted: aggregate.storyPointsCompleted,
            issuesResolved: aggregate.issuesResolved,
            lastUpdatedAt: new Date(),
          },
        }
      );
    }

    job.status = 'COMPLETED';
    job.completedAt = new Date();
    job.message = `JIRA synchronization completed. Imported ${issues.length} issues (${unmappedAssigneeCount} unmapped assignees skipped).`;
    await job.save();
  } catch (error) {
    job.status = 'FAILED';
    job.completedAt = new Date();
    if (error?.code === 'ECONNABORTED') {
      job.errorCode = 'GATEWAY_TIMEOUT';
    } else if (error?.response?.status >= 500) {
      job.errorCode = 'UPSTREAM_PROVIDER_ERROR';
    } else {
      job.errorCode = error.code || 'JIRA_SYNC_FAILED';
    }
    job.errorMessage = error.message || 'JIRA sync failed unexpectedly.';
    await job.save();
  }
};

const triggerJiraSync = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';

  try {
    const group = await Group.findOne({ groupId }).lean();
    if (!group) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: `Group ${groupId} not found.` });
    }

    if (!group.jiraUrl || !group.projectKey) {
      return res.status(400).json({
        error: 'INVALID_JIRA_CONFIGURATION',
        message: 'JIRA integration is not configured for this group.',
      });
    }

    const active = await SyncJob.findOne({
      groupId,
      sprintId,
      source: 'jira',
      status: { $in: ['PENDING', 'IN_PROGRESS'] },
    }).lean();

    if (active) {
      return res.status(409).json({
        error: 'SYNC_ALREADY_RUNNING',
        message: `A JIRA sync is already running for ${groupId}/${sprintId}.`,
        jobId: active.jobId,
      });
    }

    const job = await SyncJob.create({
      groupId,
      sprintId,
      source: 'jira',
      status: 'PENDING',
      message: 'JIRA sync accepted and queued.',
      triggeredBy: actorId,
    });

    res.status(202).json({
      jobId: job.jobId,
      status: 'queued',
      source: 'jira',
      message: 'JIRA sync job accepted.',
      createdAt: job.createdAt,
    });

    setImmediate(() => {
      runJiraSyncWorker({ jobId: job.jobId, groupId, sprintId, sprintKey: req.body?.sprintKey }).catch((err) => {
        // Non-fatal because job record persists failure details.
        console.error('[runJiraSyncWorker] unhandled error:', err.message);
      });
    });
  } catch (error) {
    console.error('[triggerJiraSync] error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to trigger JIRA sync.' });
  }
};

const getJiraSyncStatus = async (req, res) => {
  const { groupId, sprintId, jobId } = req.params;
  try {
    const query = jobId
      ? { groupId, sprintId, source: 'jira', jobId }
      : { groupId, sprintId, source: 'jira' };
    const sort = jobId ? undefined : { createdAt: -1 };
    const job = await SyncJob.findOne(query, null, sort ? { sort } : {}).lean();
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `No JIRA sync job found for ${groupId}/${sprintId}.`,
      });
    }
    return res.status(200).json(mapJobResponse(job));
  } catch (error) {
    console.error('[getJiraSyncStatus] error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch JIRA sync status.' });
  }
};

const getJiraSyncLogs = async (req, res) => {
  const { groupId, sprintId, jobId } = req.params;
  try {
    const job = await SyncJob.findOne({ groupId, sprintId, source: 'jira', jobId }).lean();
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `No JIRA sync job found for ${groupId}/${sprintId}/${jobId}.`,
      });
    }

    const logs = [
      { level: 'info', at: job.createdAt, message: 'JIRA sync job created.' },
      job.startedAt ? { level: 'info', at: job.startedAt, message: 'JIRA sync worker started.' } : null,
      job.message ? { level: job.status === 'FAILED' ? 'error' : 'info', at: job.updatedAt || job.createdAt, message: job.message } : null,
      job.errorMessage ? { level: 'error', at: job.completedAt || job.updatedAt, message: job.errorMessage } : null,
      job.completedAt ? { level: 'info', at: job.completedAt, message: `JIRA sync finished with status ${toPublicStatus(job.status)}.` } : null,
    ].filter(Boolean);

    return res.status(200).json({
      jobId: job.jobId,
      source: 'jira',
      status: toPublicStatus(job.status),
      logs,
    });
  } catch (error) {
    console.error('[getJiraSyncLogs] error:', error);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch JIRA sync logs.' });
  }
};

const recalculateContributions = async (req, res) => {
  const { groupId, sprintId } = req.params;

  try {
    const group = await Group.findOne({ groupId }).lean();
    if (!group) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: `Group ${groupId} not found.` });
    }

    const acceptedMembers = (group.members || []).filter((member) => member.status === 'accepted');
    if (acceptedMembers.length === 0) {
      return res.status(200).json({
        groupId,
        sprintId,
        contributions: [],
        recalculatedAt: new Date().toISOString(),
        basedOnTargets: false,
        warnings: ['No accepted group members found.'],
        summary: 'No contribution records were generated.',
      });
    }

    const existing = await ContributionRecord.find({ groupId, sprintId }).lean();
    const existingByStudent = new Map(existing.map((record) => [record.studentId, record]));

    for (const member of acceptedMembers) {
      if (!existingByStudent.has(member.userId)) {
        await ContributionRecord.create({
          groupId,
          sprintId,
          studentId: member.userId,
          storyPointsAssigned: 0,
          storyPointsCompleted: 0,
          contributionRatio: 0,
          gitHubHandle: null,
        });
      }
    }

    const acceptedMemberIds = acceptedMembers.map((member) => member.userId);
    const allRecords = await ContributionRecord.find({
      groupId,
      sprintId,
      studentId: { $in: acceptedMemberIds },
    }).lean();

    const latestGithubJob = await GitHubSyncJob.findOne(
      { groupId, sprintId, status: 'COMPLETED' },
      null,
      { sort: { createdAt: -1 } }
    ).lean();
    const validationRecords = Array.isArray(latestGithubJob?.validationRecords)
      ? latestGithubJob.validationRecords
      : [];
    const mergedIssueKeys = new Set(
      validationRecords
        .filter((record) => record.mergeStatus === 'MERGED')
        .map((record) => record.issueKey)
    );

    const users = await User.find(
      { userId: { $in: acceptedMemberIds } },
      { userId: 1, email: 1, githubUsername: 1 }
    ).lean();
    const usersById = new Map(users.map((user) => [user.userId, user]));

    const projectedRows = allRecords.map((record) => {
      const keys = record.jiraIssueKeys || [];
      const mergedKeys = keys.filter((key) => mergedIssueKeys.has(key));
      const unmergedKeys = keys.filter((key) => !mergedIssueKeys.has(key));

      let completedFromMerge = 0;
      if (keys.length > 0) {
        // Heuristic: proportional credit if per-issue SP isn't stored
        completedFromMerge =
          (mergedKeys.length / keys.length) *
          Number(record.storyPointsAssigned || record.storyPointsCompleted || 0);
      }

      const warnings = [];
      if (keys.length === 0) {
        warnings.push('No JIRA issue mapping found for student record.');
      }
      if (validationRecords.length > 0) {
        unmergedKeys.forEach((key) => {
          warnings.push(`Mapped issue ${key} is not merged in latest GitHub sync.`);
        });
      }
      if (validationRecords.length === 0) {
        warnings.push(
          'No completed GitHub sync validation found; using zero completed SP from merge mapping.'
        );
        completedFromMerge = 0;
      }
      return {
        record,
        completedFromMerge,
        warnings,
      };
    });

    const totalCompleted = projectedRows.reduce((sum, row) => sum + row.completedFromMerge, 0);

    const contributions = [];
    for (const row of projectedRows) {
      const { record, warnings } = row;
      const completed = row.completedFromMerge;
      const target = Number(record.storyPointsAssigned || 0);
      const ratio = target > 0 ? completed / target : 0;
      const user = usersById.get(record.studentId);
      const studentName = user?.email || record.studentId;
      const githubUsername = record.gitHubHandle || user?.githubUsername || record.studentId;
      if (target <= 0) {
        warnings.push('Target story points are zero; ratio is set to 0.');
      }

      await ContributionRecord.updateOne(
        { contributionRecordId: record.contributionRecordId },
        {
          $set: {
            storyPointsCompleted: completed,
            contributionRatio: ratio,
            lastUpdatedAt: new Date(),
          },
        }
      );

      contributions.push({
        studentId: record.studentId,
        studentName,
        githubUsername,
        completedStoryPoints: completed,
        targetStoryPoints: target,
        groupTotalStoryPoints: totalCompleted,
        contributionRatio: ratio,
        mappingWarnings: warnings,
        mappingWarningsCount: warnings.length,
      });
    }

    const summaryWarnings = [];
    if (!latestGithubJob) {
      summaryWarnings.push('No completed GitHub sync job found for this sprint; completed SP values may be zero.');
    }

    return res.status(200).json({
      groupId,
      sprintId,
      contributions,
      recalculatedAt: new Date().toISOString(),
      basedOnTargets: true,
      warnings: summaryWarnings,
      summary: `Recalculated contributions for ${contributions.length} students.`,
    });
  } catch (error) {
    console.error('[recalculateContributions] error:', error);
    return res
      .status(500)
      .json({ error: 'INTERNAL_ERROR', message: 'Failed to recalculate contributions.' });
  }
};

module.exports = {
  triggerJiraSync,
  getJiraSyncStatus,
  getJiraSyncLogs,
  recalculateContributions,
};
