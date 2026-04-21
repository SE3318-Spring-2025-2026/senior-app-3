import apiClient from './apiClient';

/**
 * Fetch the authenticated student's read-only sprint contribution metrics.
 * Backend enforces self-only access and returns the D6-backed values as-is.
 */
export const getMySprintProgress = async (groupId, sprintId) => {
  const response = await apiClient.get(
    `/groups/${groupId}/sprints/${sprintId}/contributions/me`
  );
  return response.data;
};
