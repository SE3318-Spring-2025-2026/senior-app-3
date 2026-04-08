import apiClient from './apiClient';

/**
 * Advisor Association Service
 * Handles advisor request, advisor status, and advisor release flows.
 */

/**
 * Submit a new advisee request
 * POST /advisor-requests
 */
export const submitAdvisorRequest = async ({ groupId, professorId, message }) => {
  const response = await apiClient.post('/advisor-requests', {
    groupId,
    professorId,
    message: message?.trim() || undefined,
  });
  return response.data;
};

/**
 * Get advisor association schedule window
 */
export const getAdvisorAssociationWindow = async () => {
  try {
    const response = await apiClient.get('/schedule-window/active', {
      params: { operationType: 'advisor_association' },
    });
    return response.data;
  } catch (error) {
    return { open: false, window: null };
  }
};

/**
 * Release the assigned advisor from a group
 * DELETE /groups/{groupId}/advisor
 */
export const releaseAdvisor = async (groupId) => {
  const response = await apiClient.delete(`/groups/${groupId}/advisor`);
  return response.data;
};

/**
 * Search / list professors for advisor request form
 * This endpoint may need adjustment based on backend OpenAPI.
 */
export const searchProfessors = async (query = '') => {
  const response = await apiClient.get('/professors', {
    params: query ? { q: query } : {},
  });
  return response.data;
};