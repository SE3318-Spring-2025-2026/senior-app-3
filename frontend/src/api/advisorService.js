import apiClient from './apiClient';

/**
 * Submit an advisee request to a professor (Process 3.1)
 */
export const submitAdvisorRequest = async (groupId, professorId, message) => {
  const response = await apiClient.post('/advisor-requests', {
    groupId,
    professorId,
    message,
  });
  return response.data;
};

/**
 * Get the list of available professors for advisor association
 */
export const getProfessors = async () => {
  const response = await apiClient.get('/auth/users/professors');
  return response.data.professors;
};

/**
 * Check if the advisor association window is open
 */
export const checkAdvisorWindow = async () => {
  const response = await apiClient.get('/schedule-window/active', {
    params: { operationType: 'advisor_association' }
  });
  return response.data;
};

/**
 * Team Leader: release the currently assigned advisor (backend uses a transaction)
 */
export const releaseAdvisor = async (groupId, reason = '') => {
  const response = await apiClient.post(`/groups/${groupId}/release-advisor`, {
    reason,
  });
  return response.data;
};
