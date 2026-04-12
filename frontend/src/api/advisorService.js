import apiClient from './apiClient';

/**
 * Advisor Association Service
 * Handles advisor request, status, and release flows (Process 3.1 - 3.7)
 */

/**
 * Submit an advisee request to a professor (Process 3.1)
 * Uses object destructuring to match the updated service signature.
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
 * Check if the advisor association window is open (Process 3.0)
 * Returns window data or closed status.
 */
export const getAdvisorAssociationWindow = async () => {
  try {
    const response = await apiClient.get('/schedule-window/active', {
      params: { operationType: 'advisor_association' },
    });
    return response.data;
  } catch (error) {
    // Graceful degradation for UI: assume closed if check fails
    return { open: false, window: null };
  }
};

/**
 * Search / list professors for advisor request form
 * Fetches users with professor role (D1)
 */
export const searchProfessors = async (query = '') => {
  const response = await apiClient.get('/users', {
    params: { role: 'professor', ...(query && { q: query }) },
  });
  // Supports both simple list and search result structures
  return response.data.professors || response.data;
};

/**
 * Release the currently assigned advisor from the group (Process 3.5)
 * Available to Team Leader or Coordinator.
 * @param {string} groupId - Target group
 * @param {string} reason - Optional reason for audit logs
 */
export const releaseAdvisor = async (groupId, reason = '') => {
  const response = await apiClient.delete(`/groups/${groupId}/advisor`, {
    data: { reason: reason.trim() }
  });
  return response.data;
};

/**
 * Coordinator Transfer: reassign a group to a new advisor (Process 3.6)
 * Exclusively used by the Coordinator Dashboard.
 */
export const transferAdvisor = async (groupId, { newProfessorId, reason }) => {
  const response = await apiClient.post(`/groups/${groupId}/advisor/transfer`, {
    newProfessorId,
    reason: reason?.trim()
  });
  return response.data;
};