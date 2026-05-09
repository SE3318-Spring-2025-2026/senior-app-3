'use strict';

const JiraSyncJob = require('../models/JiraSyncJob');
const SprintIssue = require('../models/SprintIssue');
const SprintRecord = require('../models/SprintRecord');
const { jiraSyncWorker, JiraSyncError, getJiraConfig, getPublishedSprintConfig } = require('../services/jiraSyncService');
const { createAuditLog } = require('../services/auditService');

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
  source: 'jira',
  message: job.errorMessage || null,
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

const triggerJiraSync = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';
  const correlationId = req.headers['x-correlation-id'] || `jira_${Date.now()}`;

  try {
    await getJiraConfig(groupId);
    await getPublishedSprintConfig(groupId, sprintId);

    const sprintRecord = await SprintRecord.findOne({ groupId, sprintId }).lean();
    if (sprintRecord && ['completed', 'reviewed'].includes(sprintRecord.status)) {
      return res.status(409).json({
        error: 'SNAPSHOT_LOCKED',
        message: `Sprint contribution snapshot for group ${groupId} / sprint ${sprintId} is already finalized.`,
        source: 'jira',
      });
    }

    const existingLock = await JiraSyncJob.findOne({
      groupId,
      sprintId,
      status: { $in: ['PENDING', 'IN_PROGRESS'] },
    }).lean();

    if (existingLock) {
      return res.status(409).json({
        error: 'SYNC_ALREADY_RUNNING',
        message: `A JIRA sync is already in progress for group ${groupId} / sprint ${sprintId}`,
        jobId: existingLock.jobId,
        source: 'jira',
      });
    }

    let job;
    try {
      job = await JiraSyncJob.create({
        groupId,
        sprintId,
        status: 'PENDING',
        triggeredBy: actorId,
        correlationId,
      });
    } catch (err) {
      if (err.code === 11000) {
        const racingJob = await JiraSyncJob.findOne({
          groupId,
          sprintId,
          status: { $in: ['PENDING', 'IN_PROGRESS'] },
        }).lean();

        return res.status(409).json({
          error: 'SYNC_ALREADY_RUNNING',
          message: `A JIRA sync was just triggered for group ${groupId} / sprint ${sprintId}`,
          jobId: racingJob?.jobId,
          source: 'jira',
        });
      }

      throw err;
    }

    try {
      await createAuditLog({
        action: 'JIRA_SYNC_INITIATED',
        actorId,
        groupId,
        targetId: job.jobId,
        payload: {
          sprintId,
          jobId: job.jobId,
          source: 'jira',
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId,
      });
    } catch (auditErr) {
      console.error('[triggerJiraSync] Audit log failed (non-fatal):', auditErr.message);
    }

    res.status(202).json({
      jobId: job.jobId,
      status: 'queued',
      source: 'jira',
      message: 'JIRA sync job accepted. Sprint issues will be fetched asynchronously.',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });

    setImmediate(() => {
      jiraSyncWorker(groupId, sprintId, job.jobId).catch((err) => {
        console.error('[triggerJiraSync] Unhandled worker error:', err.message);
      });
    });
  } catch (err) {
    if (err instanceof JiraSyncError) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
      });
    }

    console.error('[triggerJiraSync] Unexpected error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

const getJiraSyncStatus = async (req, res) => {
  const { groupId, sprintId, jobId } = req.params;

  try {
    const query = jobId ? { groupId, sprintId, jobId } : { groupId, sprintId };
    const options = jobId ? {} : { sort: { createdAt: -1 } };
    const job = await JiraSyncJob.findOne(query, null, options).lean();

    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `No JIRA sync job found for ${groupId}/${sprintId}.`,
      });
    }

    return res.status(toHttpStatus(job.status, job.errorCode)).json(mapJobResponse(job));
  } catch (err) {
    console.error('[getJiraSyncStatus] Unexpected error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

const getJiraSyncLogs = async (req, res) => {
  const { groupId, sprintId, jobId } = req.params;

  try {
    const job = await JiraSyncJob.findOne({ groupId, sprintId, jobId }).lean();
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `No JIRA sync job found for ${groupId}/${sprintId}/${jobId}.`,
      });
    }

    const logs = [
      { level: 'info', at: job.createdAt, message: 'JIRA sync job created.' },
      job.startedAt ? { level: 'info', at: job.startedAt, message: 'JIRA sync worker started.' } : null,
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
  } catch (err) {
    console.error('[getJiraSyncLogs] Unexpected error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

/**
 * DEV-ONLY: Mock Jira sync — creates fake SprintIssue records and a completed
 * JiraSyncJob without calling the real Jira API.
 * POST /groups/:groupId/sprints/:sprintId/jira-sync/mock
 * Returns 404 in production.
 */
const mockJiraSync = async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ message: 'Not found' });
  }

  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';

  try {
    const MOCK_ISSUES = [
      { key: 'MOCK-101', summary: 'Implement authentication module',  points: 5, status: 'Done',        assignee: 'Alice Student'   },
      { key: 'MOCK-102', summary: 'Setup MongoDB schemas',             points: 3, status: 'Done',        assignee: 'Bob Student'     },
      { key: 'MOCK-103', summary: 'Build REST API endpoints',          points: 8, status: 'In Progress', assignee: 'Alice Student'   },
      { key: 'MOCK-104', summary: 'Write unit and integration tests',  points: 5, status: 'In Progress', assignee: 'Charlie Student' },
      { key: 'MOCK-105', summary: 'Deploy to staging environment',     points: 3, status: 'To Do',       assignee: 'Bob Student'     },
    ];

    // Upsert each mock issue
    for (const issue of MOCK_ISSUES) {
      await SprintIssue.findOneAndUpdate(
        { groupId, sprintId, issueKey: issue.key },
        {
          groupId,
          sprintId,
          issueKey:            issue.key,
          storyPoints:         issue.points,
          status:              issue.status,
          assigneeDisplayName: issue.assignee,
          rawIssue:            { key: issue.key, fields: { summary: issue.summary } },
          syncedAt:            new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Create a completed JiraSyncJob record
    const now = new Date();
    const job = await JiraSyncJob.create({
      groupId,
      sprintId,
      source:          'jira',
      status:          'COMPLETED',
      issuesProcessed: MOCK_ISSUES.length,
      issuesUpserted:  MOCK_ISSUES.length,
      startedAt:       now,
      completedAt:     now,
      triggeredBy:     actorId,
      correlationId:   `mock_${Date.now()}`,
    });

    return res.status(200).json({
      ...mapJobResponse(job),
      mock: true,
      issuesCreated: MOCK_ISSUES.length,
    });
  } catch (err) {
    console.error('[mockJiraSync] error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
};

module.exports = { triggerJiraSync, getJiraSyncStatus, getJiraSyncLogs, mockJiraSync };
