'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const Group = require('../models/Group');
const SprintConfig = require('../models/SprintConfig');
const SprintRecord = require('../models/SprintRecord');
const Deliverable = require('../models/Deliverable');
const ContributionRecord = require('../models/ContributionRecord');
const SyncJob = require('../models/SyncJob');
const GitHubSyncJob = require('../models/GitHubSyncJob');
const User = require('../models/User');
const { decrypt } = require('../utils/cryptoUtils');
const { dispatchSyncNotification } = require('../services/notificationService');

const toPublicStatus = (status) => {
  if (status === 'PENDING') return 'queued';
  if (status === 'IN_PROGRESS') return 'running';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'queued';
};

const toHttpStatus = (status, errorCode = null) => {
  if (status === 'COMPLETED') return 200;
  if (status === 'FAILED') {
    if (errorCode === 'GATEWAY_TIMEOUT') return 504;
    if (errorCode === 'UPSTREAM_PROVIDER_ERROR') return 502;
    return 500;
  }
  return 202;
};

const mapJobResponse = (job) => ({
  jobId: job.jobId,
  job_id: job.jobId,
  status: toPublicStatus(job.status),
  source: job.source,
  message: job.message,
  groupId: job.groupId,
  group_id: job.groupId,
  sprintId: job.sprintId,
  sprint_id: job.sprintId,
  startedAt: job.startedAt,
  started_at: job.startedAt,
  completedAt: job.completedAt,
  completed_at: job.completedAt,
  errorCode: job.errorCode,
  error_code: job.errorCode,
  errorMessage: job.errorMessage,
  error_message: job.errorMessage,
  createdAt: job.createdAt,
  created_at: job.createdAt,
  updatedAt: job.updatedAt,
  updated_at: job.updatedAt,
  mappedHttpStatus: toHttpStatus(job.status, job.errorCode),
  mapped_http_status: toHttpStatus(job.status, job.errorCode),
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

const getPublishedSprintConfig = async (groupId, sprintId) => {
  const config = await SprintConfig.findOne({
    groupId,
    sprintId,
    configurationStatus: 'published',
    deadline: { $gte: new Date() },
  }).lean();

  if (!config) {
    const error = new Error(`No published sprint configuration found for ${groupId}/${sprintId}.`);
    error.status = 422;
    error.code = 'SPRINT_CONFIG_NOT_PUBLISHED';
    throw error;
  }

  if (!config.externalSprintKey) {
    const error = new Error(`Published sprint configuration for ${sprintId} is missing externalSprintKey.`);
    error.status = 422;
    error.code = 'SPRINT_CONFIG_INCOMPLETE';
    throw error;
  }

  return config;
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

const normalizeWorkerError = (error) => {
  if (error?.code === 'ECONNABORTED') {
    return {
      errorCode: 'GATEWAY_TIMEOUT',
      errorMessage: 'JIRA API timed out after maximum retry attempts.',
    };
  }

  if (error?.response?.status >= 500) {
    return {
      errorCode: 'UPSTREAM_PROVIDER_ERROR',
      errorMessage: error.message || 'JIRA API returned an upstream provider error.',
    };
  }

  return {
    errorCode: error?.code || 'JIRA_SYNC_FAILED',
    errorMessage: error?.message || 'JIRA sync failed unexpectedly.',
  };
};

const runJiraSyncWorker = async ({ jobId, groupId, sprintId, sprintKey }) => {
  const job = await SyncJob.findOne({ jobId });
  if (!job) return;

  const session = await mongoose.startSession();

  try {
    job.status = 'IN_PROGRESS';
    job.startedAt = new Date();
    job.message = 'JIRA synchronization is running.';
    await job.save();

    const correlationId = job.correlationId;

    const group = await Group.findOne({ groupId }).select('+jiraToken').lean();
    if (!group) {
      throw Object.assign(new Error(`Group ${groupId} not found.`), { code: 'GROUP_NOT_FOUND' });
    }

    if (!group.jiraUrl || !group.jiraUsername || !group.jiraToken || !group.projectKey) {
      throw Object.assign(new Error('JIRA integration credentials are missing.'), {
        code: 'INVALID_JIRA_CONFIGURATION',
      });
    }

    const sprintConfig = await getPublishedSprintConfig(groupId, sprintId);
    const effectiveSprintKey = sprintConfig.externalSprintKey || sprintKey || sprintId;
    const issues = await fetchJiraIssues({ group, sprintKey: effectiveSprintKey, sprintId });

    const deliverableRefs = issues.map((issue) => ({
      deliverableId: issue.key,
      // SprintRecord schema has fixed enum; we keep all imported JIRA issues under this bucket.
      type: 'demonstration',
      submittedAt: new Date(issue.fields?.updated || issue.fields?.created || Date.now()),
    }));

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

    await session.withTransaction(async () => {
      // ── Atomic Read ────────────────────────────────────────────────────────
      const sprintRecord = await SprintRecord.findOne({ groupId, sprintId }).session(session);
      if (sprintRecord && ['completed', 'reviewed'].includes(sprintRecord.status)) {
        throw Object.assign(new Error('Sprint contribution snapshot is finalized and locked.'), {
          code: 'SNAPSHOT_LOCKED',
        });
      }

      const existingRecords = await ContributionRecord.find({ groupId, sprintId }).session(session);
      const existingByStudent = new Map(existingRecords.map((record) => [record.studentId, record]));

      const sprintUpdate = {
        $set: {
          status: 'in_progress',
        },
        $setOnInsert: {
          groupId,
          sprintId,
        },
      };

      if (sprintConfig.enableD4Reporting) {
        sprintUpdate.$set.deliverableRefs = deliverableRefs;

        const deliverableOps = deliverableRefs.map((ref) => ({
          updateOne: {
            filter: { deliverableId: ref.deliverableId, groupId },
            update: {
              $set: {
                deliverableType: 'demonstration',
                sprintId,
                submittedBy: 'system-jira-sync',
                filePath: `jira://${ref.deliverableId}`,
                fileSize: 0,
                fileHash: 'jira-synced',
                format: 'jira-issue',
                status: 'accepted',
                submittedAt: ref.submittedAt,
              },
            },
            upsert: true,
          },
        }));

        if (deliverableOps.length > 0) {
          await Deliverable.bulkWrite(deliverableOps, { session });
        }
      }

      await SprintRecord.findOneAndUpdate(
        { groupId, sprintId },
        sprintUpdate,
        { upsert: true, new: true, session }
      );

      const contributionOps = Array.from(acceptedMemberIds).map((studentId) => {
        const aggregate = aggregatedByStudent.get(studentId) || {
          issueKeys: [],
          storyPointsAssigned: 0,
          storyPointsCompleted: 0,
          issuesResolved: 0,
        };
        const existing = existingByStudent.get(studentId);

        if (existing) {
          return {
            updateOne: {
              filter: { contributionRecordId: existing.contributionRecordId },
              update: {
                $set: {
                  jiraIssueKeys: aggregate.issueKeys,
                  jiraIssueKey: aggregate.issueKeys[0] || null,
                  storyPointsAssigned: aggregate.storyPointsAssigned,
                  storyPointsCompleted: aggregate.storyPointsCompleted,
                  issuesResolved: aggregate.issuesResolved,
                  lastUpdatedAt: new Date(),
                },
              },
            },
          };
        }

        return {
          updateOne: {
            filter: { groupId, sprintId, studentId },
            update: {
              $set: {
                jiraIssueKeys: aggregate.issueKeys,
                jiraIssueKey: aggregate.issueKeys[0] || null,
                storyPointsAssigned: aggregate.storyPointsAssigned,
                storyPointsCompleted: aggregate.storyPointsCompleted,
                issuesResolved: aggregate.issuesResolved,
                lastUpdatedAt: new Date(),
              },
              $setOnInsert: {
                contributionRecordId: `ctr_${new mongoose.Types.ObjectId().toString().slice(-8)}`,
                groupId,
                sprintId,
                studentId,
              },
            },
            upsert: true,
          },
        };
      });

      if (contributionOps.length > 0) {
        await ContributionRecord.bulkWrite(contributionOps, { session });
      }
    });

    job.status = 'COMPLETED';
    job.completedAt = new Date();
    job.message = `JIRA synchronization completed. Imported ${issues.length} issues (${unmappedAssigneeCount} unmapped assignees skipped).`;
    await job.save();

    // Trigger completion notification with correlationId
    dispatchSyncNotification({
      groupId,
      sprintId,
      status: 'COMPLETED',
      issuesProcessed: issues.length,
      triggeredBy: job.triggeredBy || 'system',
      correlationId,
    });
  } catch (error) {
    const normalized = normalizeWorkerError(error);
    job.status = 'FAILED';
    job.completedAt = new Date();
    job.errorCode = normalized.errorCode;
    job.errorMessage = normalized.errorMessage;
    await job.save();
  } finally {
    await session.endSession();
  }
};

const triggerJiraSync = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';
  const correlationId = req.headers['x-correlation-id'] || `jira_${Date.now()}`;

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

    await getPublishedSprintConfig(groupId, sprintId);

    const sprintRecord = await SprintRecord.findOne({ groupId, sprintId }).lean();
    if (sprintRecord && ['completed', 'reviewed'].includes(sprintRecord.status)) {
      return res.status(409).json({
        error: 'SNAPSHOT_LOCKED',
        message: `Sprint contribution snapshot for ${groupId}/${sprintId} is already finalized.`,
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
      correlationId,
    });

    res.status(202).json({
      jobId: job.jobId,
      job_id: job.jobId,
      status: 'queued',
      source: 'jira',
      message: 'JIRA sync job accepted.',
      createdAt: job.createdAt,
      created_at: job.createdAt,
    });

    setImmediate(() => {
      runJiraSyncWorker({ jobId: job.jobId, groupId, sprintId, sprintKey: req.body?.sprintKey }).catch((err) => {
        // Non-fatal because job record persists failure details.
        console.error('[runJiraSyncWorker] unhandled error:', err.message);
      });
    });
  } catch (error) {
    if (error?.status === 422) {
      return res.status(422).json({
        error: error.code || 'SPRINT_CONFIG_NOT_PUBLISHED',
        message: error.message,
      });
    }
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
    return res.status(toHttpStatus(job.status, job.errorCode)).json(mapJobResponse(job));
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
      job_id: job.jobId,
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

/**
 * Flow 139 — Canonical reconciliation from D4 (Deliverables) to D6 (SprintRecord).
 * Synchronizes deliverable refs while preserving existing D6 metrics.
 */
const reconcileD4toD6 = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';
  const correlationId = req.headers['x-correlation-id'] || `reconcile_${Date.now()}`;

  try {
    const deliverables = await Deliverable.find({ groupId, sprintId }).lean();
    const sprintRecord = await SprintRecord.findOne({ groupId, sprintId });

    if (!sprintRecord) {
      return res.status(404).json({
        error: 'SPRINT_RECORD_NOT_FOUND',
        message: `Sprint record not found for ${groupId}/${sprintId}`,
      });
    }

    const existingRefsMap = new Map(
      (sprintRecord.deliverableRefs || []).map((ref) => [ref.deliverableId, ref])
    );

    let addedCount = 0;
    for (const del of deliverables) {
      if (!existingRefsMap.has(del.deliverableId)) {
        sprintRecord.deliverableRefs.push({
          deliverableId: del.deliverableId,
          type: del.deliverableType,
          submittedAt: del.submittedAt,
        });
        addedCount += 1;
      }
    }

    if (addedCount > 0) {
      await sprintRecord.save();
    }

    await createAuditLog({
      action: 'DELIVERABLE_LINKED_TO_SPRINT',
      actorId,
      groupId,
      targetId: sprintRecord.sprintId,
      payload: { addedCount, totalRefs: sprintRecord.deliverableRefs.length },
      correlationId,
    });

    return res.status(200).json({
      success: true,
      groupId,
      sprintId,
      addedCount,
      totalRefs: sprintRecord.deliverableRefs.length,
      message: `Reconciliation complete. Added ${addedCount} missing deliverable references.`,
    });
  } catch (error) {
    console.error('[reconcileD4toD6] error:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to reconcile D4 deliverables to D6 sprint record.',
    });
  }
};

module.exports = {
  triggerJiraSync,
  getJiraSyncStatus,
  getJiraSyncLogs,
  recalculateContributions,
  reconcileD4toD6,
};
