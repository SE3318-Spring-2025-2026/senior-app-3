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
 * Release the currently assigned advisor from the group (Process 3.5)
 * Team Leader or Coordinator: releases the currently assigned advisor (backend uses a transaction)
 */
export const releaseAdvisor = async (groupId, professorId, reason = '') => {
  const response = await apiClient.delete(`/groups/${groupId}/advisor`, {
    data: { professorId, reason }
  });
  return response.data;
};