import apiClient from './apiClient';
import { TERMINAL_JOB_STATUSES } from '../types/sprintTracking';

const STATUS_POLL_INTERVAL_MS = 2500;
const STATUS_POLL_MAX_MS = 120000;
const STATUS_POLL_MAX_CONSECUTIVE_ERRORS = 5;

const toLower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

const normalizeStatus = (rawStatus) => {
  const status = toLower(rawStatus);
  if (status === 'pending' || status === 'queued') return 'queued';
  if (status === 'in_progress' || status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'queued';
};

const deriveProgress = (status) => {
  if (status === 'queued') return 20;
  if (status === 'running') return 65;
  if (status === 'completed') return 100;
  return 100;
};

const normalizeSyncJob = (source, payload = {}) => {
  const status = normalizeStatus(payload.status);
  return {
    jobId: payload.jobId || payload.job_id || '',
    status,
    source,
    message: payload.message || null,
    startedAt: payload.startedAt || null,
    completedAt: payload.completedAt || null,
    createdAt: payload.createdAt || null,
    updatedAt: payload.updatedAt || null,
    errorCode: payload.errorCode || payload.error_code || null,
    lastError: payload.last_error || payload.errorMessage || payload.message || null,
    validationRecords: Array.isArray(payload.validationRecords) ? payload.validationRecords : [],
    progress: deriveProgress(status),
  };
};

const buildJiraPayload = ({ coordinatorId, jiraBoardId, sprintKey }) => ({
  coordinatorId,
  jiraBoardId,
  sprintKey,
  retryOnFailure: true,
  notifyOnCompletion: false,
});

const buildGithubPayload = ({ coordinatorId, repositorySlug }) => ({
  coordinatorId,
  repositorySlug,
  revalidateAll: false,
});

const buildRecalculatePayload = ({ triggeredBy }) => ({
  triggeredBy,
  overrideExisting: true,
  notifyStudents: false,
  useRubricWeights: true,
});

export const triggerJiraSync = async ({ groupId, sprintId, coordinatorId, jiraBoardId, sprintKey }) => {
  const response = await apiClient.post(
    `/groups/${groupId}/sprints/${sprintId}/jira-sync`,
    buildJiraPayload({ coordinatorId, jiraBoardId, sprintKey })
  );
  return normalizeSyncJob('jira', response.data);
};

export const triggerGithubSync = async ({ groupId, sprintId, coordinatorId, repositorySlug }) => {
  const response = await apiClient.post(
    `/groups/${groupId}/sprints/${sprintId}/github-sync`,
    buildGithubPayload({ coordinatorId, repositorySlug })
  );
  return normalizeSyncJob('github', response.data);
};

export const getLatestSyncJob = async ({ source, groupId, sprintId }) => {
  const response = await apiClient.get(`/groups/${groupId}/sprints/${sprintId}/${source}-sync`);
  return normalizeSyncJob(source, response.data);
};

export const getSyncJobById = async ({ source, groupId, sprintId, jobId }) => {
  const response = await apiClient.get(`/groups/${groupId}/sprints/${sprintId}/${source}-sync/${jobId}`);
  return normalizeSyncJob(source, response.data);
};

export const getSyncJobLogs = async ({ source, groupId, sprintId, jobId }) => {
  const response = await apiClient.get(`/groups/${groupId}/sprints/${sprintId}/${source}-sync/${jobId}/logs`);
  const data = response.data || {};
  return {
    jobId: data.jobId || jobId,
    source,
    status: normalizeStatus(data.status),
    logs: Array.isArray(data.logs) ? data.logs : [],
  };
};

export const pollSyncJobUntilTerminal = async ({ source, groupId, sprintId, jobId, onTick }) => {
  const startedAt = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - startedAt < STATUS_POLL_MAX_MS) {
    try {
      const job = jobId
        ? await getSyncJobById({ source, groupId, sprintId, jobId })
        : await getLatestSyncJob({ source, groupId, sprintId });

      consecutiveErrors = 0;

      if (typeof onTick === 'function') {
        onTick(job);
      }

      if (TERMINAL_JOB_STATUSES.includes(job.status)) {
        return job;
      }
    } catch (error) {
      consecutiveErrors += 1;
      const status = error?.response?.status;
      const shouldFailImmediately = status >= 400 && status < 500 && status !== 429;

      if (shouldFailImmediately || consecutiveErrors >= STATUS_POLL_MAX_CONSECUTIVE_ERRORS) {
        return {
          jobId: jobId || '',
          status: 'failed',
          source,
          message: error?.response?.data?.message || error?.message || 'Polling failed due to repeated errors.',
          startedAt: null,
          completedAt: null,
          createdAt: null,
          updatedAt: null,
          errorCode: error?.response?.data?.error || (shouldFailImmediately ? 'POLL_CLIENT_ERROR' : 'POLL_RETRY_EXHAUSTED'),
          lastError: error?.response?.data?.message || error?.message || 'Polling failed due to repeated errors.',
          progress: 100,
        };
      }
    }

    const adaptiveDelay = STATUS_POLL_INTERVAL_MS * (1 + Math.min(consecutiveErrors, 3));
    await new Promise((resolve) => setTimeout(resolve, adaptiveDelay));
  }

  return {
    jobId: jobId || '',
    status: 'failed',
    source,
    message: 'Polling timed out before job reached a terminal state.',
    startedAt: null,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    errorCode: 'POLL_TIMEOUT',
    lastError: 'Polling timed out before job reached a terminal state.',
    progress: 100,
  };
};

const extractWarnings = (entry = {}) => {
  const warningFields = [entry.mappingWarnings, entry.warnings, entry.warningMessages, entry.warning];
  return warningFields
    .flatMap((item) => (Array.isArray(item) ? item : item ? [String(item)] : []))
    .filter(Boolean);
};

const deriveWarningCount = (entry = {}, warnings = []) => {
  const explicitCount =
    entry.mappingWarningsCount ??
    entry.mappingWarningCount ??
    entry.warningsCount ??
    entry.warningCount;
  const numericCount = Number(explicitCount);
  if (Number.isFinite(numericCount) && numericCount >= 0) {
    return Math.trunc(numericCount);
  }
  return warnings.length;
};

const normalizeContributionRow = (entry = {}) => {
  const warnings = extractWarnings(entry);
  return {
    studentId: entry.studentId || '',
    studentName: entry.studentName || entry.githubUsername || entry.studentId || 'Unknown',
    completedStoryPoints: Number(entry.completedStoryPoints || 0),
    targetStoryPoints: Number(entry.targetStoryPoints || 0),
    contributionRatio: Number(entry.contributionRatio || 0),
    mappingWarningsCount: deriveWarningCount(entry, warnings),
    warnings,
  };
};

/**
 * Coordinator-only: bootstrap an empty SprintRecord for a group when no
 * Jira/GitHub sync has produced one yet. The optional `sprintId` is auto-
 * generated server-side as `bootstrap-sprint-N` when omitted.
 */
export const bootstrapSprint = async ({ groupId, sprintId, status, committeeId } = {}) => {
  const payload = {};
  if (sprintId) payload.sprintId = sprintId.trim();
  if (status) payload.status = status;
  if (committeeId) payload.committeeId = committeeId;
  const response = await apiClient.post(`/groups/${groupId}/sprints`, payload);
  return response.data;
};

export const recalculateContributions = async ({ groupId, sprintId, triggeredBy }) => {
  const response = await apiClient.post(
    `/groups/${groupId}/sprints/${sprintId}/contributions/recalculate`,
    buildRecalculatePayload({ triggeredBy })
  );

  const data = response.data || {};
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];

  return {
    groupId: data.groupId || groupId,
    sprintId: data.sprintId || sprintId,
    recalculatedAt: data.recalculatedAt || new Date().toISOString(),
    basedOnTargets: Boolean(data.basedOnTargets),
    contributions: Array.isArray(data.contributions) ? data.contributions.map(normalizeContributionRow) : [],
    summaryWarnings: warnings,
    summaryMessage:
      data.summary ||
      data.message ||
      `Recalculated ${Array.isArray(data.contributions) ? data.contributions.length : 0} student contribution records.`,
  };
};
