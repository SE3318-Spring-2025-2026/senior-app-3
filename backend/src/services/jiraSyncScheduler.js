'use strict';

const SprintConfig = require('../models/SprintConfig');
const JiraSyncJob = require('../models/JiraSyncJob');
const { jiraSyncWorker } = require('./jiraSyncService');

let schedulerHandle = null;
let schedulerTickInProgress = false;

async function enqueueEligibleSyncs() {
  const configs = await SprintConfig.find({
    configurationStatus: 'published',
    deadline: { $gte: new Date() },
    groupId: { $ne: null },
    externalSprintKey: { $ne: null },
  }).lean();

  for (const config of configs) {
    try {
      const job = await JiraSyncJob.create({
        groupId: config.groupId,
        sprintId: config.sprintId,
        status: 'PENDING',
        triggeredBy: 'system',
      });

      setImmediate(() => {
        jiraSyncWorker(config.groupId, config.sprintId, job.jobId).catch((err) => {
          console.error('[jiraSyncScheduler] Worker error:', err.message);
        });
      });
    } catch (err) {
      if (err.code !== 11000) {
        console.error('[jiraSyncScheduler] Failed to enqueue job:', err.message);
      }
    }
  }
}

function startJiraSyncScheduler() {
  if (schedulerHandle || process.env.ENABLE_JIRA_SPRINT_SYNC_SCHEDULER !== 'true') {
    return null;
  }

  const intervalMs = Number(process.env.JIRA_SPRINT_SYNC_INTERVAL_MS || 24 * 60 * 60 * 1000);
  schedulerHandle = setInterval(() => {
    if (schedulerTickInProgress) {
      return;
    }
    schedulerTickInProgress = true;
    enqueueEligibleSyncs().catch((err) => {
      console.error('[jiraSyncScheduler] Tick failed:', err.message);
    }).finally(() => {
      schedulerTickInProgress = false;
    });
  }, intervalMs);

  return schedulerHandle;
}

function stopJiraSyncScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}

module.exports = {
  enqueueEligibleSyncs,
  startJiraSyncScheduler,
  stopJiraSyncScheduler,
};
