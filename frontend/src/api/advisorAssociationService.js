/**
 * Advisor Association Service (API Wrapper)
 * 
 * Handles API calls for Issue #66 (Coordinator Panel - Advisor Association View)
 * Provides interfaces for:
 * - Retrieving all groups with advisor status
 * - Transferring advisors (Process 3.6)
 * - Triggering sanitization (Process 3.7)
 */

import apiClient from './apiClient';

/**
 * Fetch all groups with advisor status and professor information
 * 
 * GET /api/v1/groups
 * 
 * @returns {Promise<Array>} Array of groups with advisorStatus, professorId
 */
export const getGroups = async () => {
  try {
    const response = await apiClient.get('/groups');
    return response?.data?.groups || [];
  } catch (error) {
    console.error('Error fetching groups:', error);
    throw error;
  }
};

/**
 * Fetch a specific group with full advisor details
 * 
 * GET /api/v1/groups/:groupId
 * 
 * @param {string} groupId - Group ID
 * @returns {Promise<Object>} Group object with advisorStatus, professorId
 */
export const getGroupDetails = async (groupId) => {
  try {
    const response = await apiClient.get(`/groups/${groupId}`);
    return response?.data?.group || null;
  } catch (error) {
    if (error.response?.status === 404) {
      return null; // Group not found
    }
    console.error(`Error fetching group ${groupId}:`, error);
    throw error;
  }
};

/**
 * Transfer a group to a new advisor
 * 
 * POST /api/v1/groups/:groupId/advisor/transfer
 * 
 * @param {string} groupId - Group ID to transfer
 * @param {string} newProfessorId - User ID of new professor/advisor
 * @param {string} reason - Optional reason for transfer
 * @returns {Promise<Object>} Updated group object
 */
export const transferAdvisor = async (groupId, newProfessorId, reason = '') => {
  try {
    const response = await apiClient.post(`/groups/${groupId}/advisor/transfer`, {
      newProfessorId,
      coordinatorId: null, // Backend will use req.user?.userId
      reason: reason || 'Transfer via Coordinator Panel',
    });
    return response?.data;
  } catch (error) {
    const errorCode = error.response?.data?.code;
    const errorMessage = error.response?.data?.message || 'Failed to transfer advisor';
    
    // Map error codes to user-friendly messages
    if (errorCode === 'SCHEDULE_CLOSED') {
      throw new Error('Advisor assignment window is currently closed');
    } else if (errorCode === 'NOT_FOUND') {
      throw new Error('Group not found');
    } else if (errorCode === 'INVALID_ADVISOR') {
      throw new Error('Invalid advisor selected');
    } else if (errorCode === 'FORBIDDEN') {
      throw new Error('Only coordinators or admins can transfer advisors');
    } else if (errorCode === 'CONFLICT') {
      throw new Error('This advisor is already assigned to this group');
    } else {
      throw new Error(errorMessage);
    }
  }
};

/**
 * Trigger advisor sanitization (disband unassigned groups)
 * 
 * POST /api/v1/groups/advisor-sanitization
 * 
 * @param {Date} scheduleDeadline - Optional deadline to check
 * @param {string[]} groupIds - Optional specific group IDs to sanitize
 * @returns {Promise<Object>} Sanitization results with disbanded group count
 */
export const disbandUnassignedGroups = async (scheduleDeadline = null, groupIds = null) => {
  try {
    const response = await apiClient.post('/groups/advisor-sanitization', {
      scheduleDeadline,
      groupIds,
    });
    return response?.data;
  } catch (error) {
    const errorCode = error.response?.data?.code;
    const errorMessage = error.response?.data?.message || 'Failed to execute sanitization';
    
    // Map error codes to user-friendly messages
    if (errorCode === 'DEADLINE_NOT_PASSED') {
      throw new Error('Cannot sanitize before the configured deadline has passed');
    } else if (errorCode === 'FORBIDDEN') {
      throw new Error('Only coordinators or admins can trigger sanitization');
    } else if (errorCode === 'NO_GROUPS_TO_SANITIZE') {
      throw new Error('No unassigned groups found to disband');
    } else {
      throw new Error(errorMessage);
    }
  }
};

/**
 * Fetch all available professors for advisor selection
 * 
 * GET /api/v1/auth/users?role=professor
 * 
 * @returns {Promise<Array>} Array of professor users
 */
export const getAvailableProfessors = async () => {
  try {
    const response = await apiClient.get('/auth/users', {
      params: { role: 'professor' },
    });
    return response?.data?.users || [];
  } catch (error) {
    console.error('Error fetching professors:', error);
    // Return empty array as fallback
    return [];
  }
};

export default {
  getGroups,
  getGroupDetails,
  transferAdvisor,
  disbandUnassignedGroups,
  getAvailableProfessors,
};
