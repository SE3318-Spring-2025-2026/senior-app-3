/**
 * @typedef {'queued'|'running'|'completed'|'failed'} SyncJobStatus
 */

/**
 * @typedef {'jira'|'github'} SyncJobSource
 */

/**
 * @typedef {Object} SprintSyncJob
 * @property {string} jobId
 * @property {SyncJobStatus} status
 * @property {SyncJobSource} source
 * @property {string | null} message
 * @property {string | null} startedAt
 * @property {string | null} completedAt
 * @property {string | null} createdAt
 * @property {string | null} updatedAt
 * @property {string | null} errorCode
 * @property {string | null} lastError
 * @property {number} progress
 */

/**
 * @typedef {Object} SprintContributionRow
 * @property {string} studentId
 * @property {string} studentName
 * @property {number} completedStoryPoints
 * @property {number} targetStoryPoints
 * @property {number} contributionRatio
 * @property {number} mappingWarningsCount
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} SprintContributionSummaryResponse
 * @property {string} groupId
 * @property {string} sprintId
 * @property {string} recalculatedAt
 * @property {boolean} basedOnTargets
 * @property {SprintContributionRow[]} contributions
 * @property {string[]} summaryWarnings
 * @property {string} summaryMessage
 */

export const TERMINAL_JOB_STATUSES = ['completed', 'failed'];
