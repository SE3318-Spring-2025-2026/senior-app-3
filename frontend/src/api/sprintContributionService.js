import apiClient from './apiClient';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const FIELD_KEYS = [
  'groupId',
  'group_id',
  'sprintId',
  'sprint_id',
  'studentId',
  'student_id',
  'completedStoryPoints',
  'completed_story_points',
  'storyPointsCompleted',
  'contributionRatio',
  'contribution_ratio',
];

const hasProgressFields = (value) => (
  isObject(value) && FIELD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
);

const unwrapProgressPayload = (payload) => {
  if (!isObject(payload)) return null;
  if (hasProgressFields(payload)) return payload;

  const envelopeKeys = ['data', 'progress', 'contribution', 'result'];
  for (const key of envelopeKeys) {
    if (hasProgressFields(payload[key])) return payload[key];
  }

  for (const key of envelopeKeys) {
    const nested = payload[key];
    if (!isObject(nested)) continue;
    for (const nestedKey of envelopeKeys) {
      if (hasProgressFields(nested[nestedKey])) return nested[nestedKey];
    }
  }

  return null;
};

const pick = (source, keys) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return null;
};

const normalizeStatus = (status) => (
  typeof status === 'string' ? status.trim().toLowerCase() : null
);

export const isReadOnlySprintProgress = (progress) => {
  const status = normalizeStatus(progress?.status);
  return Boolean(
    progress?.locked ||
    progress?.finalized ||
    progress?.scheduleWindowClosed ||
    ['locked', 'finalized', 'closed', 'schedule_window_closed'].includes(status)
  );
};

export const normalizeSprintProgress = (payload, fallback = {}) => {
  const source = unwrapProgressPayload(payload);
  if (!source) {
    const error = new Error('Sprint progress response did not match the expected contract');
    error.code = 'INVALID_SPRINT_PROGRESS_RESPONSE';
    throw error;
  }

  return {
    groupId: pick(source, ['groupId', 'group_id']) ?? fallback.groupId ?? null,
    sprintId: pick(source, ['sprintId', 'sprint_id']) ?? fallback.sprintId ?? null,
    studentId: pick(source, ['studentId', 'student_id']) ?? null,
    githubUsername: pick(source, ['githubUsername', 'github_username', 'githubHandle', 'gitHubHandle']) ?? null,
    completedStoryPoints: pick(source, ['completedStoryPoints', 'completed_story_points', 'storyPointsCompleted']),
    targetStoryPoints: pick(source, ['targetStoryPoints', 'target_story_points', 'storyPointsAssigned']),
    groupTotalStoryPoints: pick(source, ['groupTotalStoryPoints', 'group_total_story_points', 'groupTotal', 'totalCompletedStoryPoints']),
    contributionRatio: pick(source, ['contributionRatio', 'contribution_ratio', 'ratio']),
    locked: Boolean(pick(source, ['locked', 'isLocked'])),
    finalized: Boolean(pick(source, ['finalized', 'isFinalized'])),
    scheduleWindowClosed: Boolean(pick(source, ['scheduleWindowClosed', 'schedule_window_closed', 'scheduleClosed'])),
    status: normalizeStatus(pick(source, ['status', 'recordStatus', 'record_status'])),
    recalculatedAt: pick(source, ['recalculatedAt', 'recalculated_at', 'computedAt', 'computed_at']),
    updatedAt: pick(source, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'last_updated_at']),
    basedOnTargets: pick(source, ['basedOnTargets', 'based_on_targets']),
  };
};

/**
 * Fetch the authenticated student's read-only sprint contribution metrics.
 * Backend enforces self-only access and returns the D6-backed values as-is.
 */
export const getMySprintProgress = async (groupId, sprintId) => {
  const response = await apiClient.get(
    `/groups/${groupId}/sprints/${sprintId}/contributions/me`
  );
  return normalizeSprintProgress(response.data, { groupId, sprintId });
};
