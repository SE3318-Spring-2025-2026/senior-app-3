import apiClient from './apiClient';

/**
 * Advisor Association Service
 * Handles advisor request, advisor status, and advisor release flows.
 */

/**
 * Submit a new advisee request
 * POST /api/v1/advisor-requests
 */
export const submitAdvisorRequest = async ({ groupId, professorId, message }) => {
  const response = await apiClient.post('/api/v1/advisor-requests', {
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
    const response = await apiClient.get('/api/v1/schedule-window/active', {
      params: { operationType: 'advisor_association' },
    });
    return response.data;
  } catch (error) {
    return { open: false, window: null };
  }
};

/**
 * Release the assigned advisor from a group
 * DELETE /api/v1/groups/{groupId}/advisor
 */
export const releaseAdvisor = async (groupId) => {
  const response = await apiClient.delete(`/api/v1/groups/${groupId}/advisor`);
  return response.data;
};

/**
 * Search / list professors for advisor request form
 * Fetches users with professor role
 */
export const searchProfessors = async (query = '') => {
  const response = await apiClient.get('/api/v1/users', {
    params: { role: 'professor', ...(query && { q: query }) },
  });
  return response.data;
};