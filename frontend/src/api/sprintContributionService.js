import apiClient from './apiClient';

/**
 * Fetch the D6-backed sprint contribution summary for academic oversight.
 *
 * OpenAPI alignment:
 * GET /groups/{groupId}/sprints/{sprintId}/contributions
 * Response shape mirrors SprintContributionSummary from Process 7.0.
 */
export const getSprintContributionSummary = async (groupId, sprintId) => {
  const response = await apiClient.get(`/groups/${groupId}/sprints/${sprintId}/contributions`);
  return response.data;
};

