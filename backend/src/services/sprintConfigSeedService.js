'use strict';

/**
 * Idempotent SprintConfig rows for a sprint (all deliverable types).
 * Used in local development when coordinators have not yet published deadlines in D8.
 */

const SprintConfig = require('../models/SprintConfig');

const DELIVERABLE_TYPES = [
  'proposal',
  'statement_of_work',
  'demo',
  'interim_report',
  'final_report',
];

/** When true, missing rows are created with a far-future deadline. */
function shouldAutoSeedSprintConfig() {
  if (process.env.AUTO_SEED_SPRINT_CONFIG === 'true') return true;
  if (process.env.AUTO_SEED_SPRINT_CONFIG === 'false') return false;
  return process.env.NODE_ENV === 'development';
}

/**
 * Ensures SprintConfig exists for each deliverable type for this sprint (upsert).
 * No-op in production/test unless AUTO_SEED_SPRINT_CONFIG=true explicitly.
 *
 * @param {string} sprintId
 * @returns {Promise<void>}
 */
async function ensureDemoSprintConfigsForSprint(sprintId) {
  if (!sprintId || !shouldAutoSeedSprintConfig()) return;

  const farFutureDeadline = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const ops = DELIVERABLE_TYPES.map((deliverableType) => ({
    updateOne: {
      filter: { sprintId, deliverableType },
      update: {
        $setOnInsert: {
          sprintId,
          deliverableType,
          deadline: farFutureDeadline,
          configurationStatus: 'published',
          publishedAt: new Date(),
          weight: 1,
        },
      },
      upsert: true,
    },
  }));

  await SprintConfig.bulkWrite(ops, { ordered: false });
}

module.exports = {
  ensureDemoSprintConfigsForSprint,
  shouldAutoSeedSprintConfig,
  DELIVERABLE_TYPES,
};
