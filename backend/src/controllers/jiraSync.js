'use strict';

const JiraSyncJob = require('../models/JiraSyncJob');
const { jiraSyncWorker, JiraSyncError, getJiraConfig, getPublishedSprintConfig } = require('../services/jiraSyncService');
const { createAuditLog } = require('../services/auditService');

const triggerJiraSync = async (req, res) => {
  const { groupId, sprintId } = req.params;
  const actorId = req.user?.userId || 'system';

  try {
    await getJiraConfig(groupId);
    await getPublishedSprintConfig(groupId, sprintId);

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

module.exports = { triggerJiraSync };
