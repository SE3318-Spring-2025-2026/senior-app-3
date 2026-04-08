import apiClient from './apiClient';

/**
 * Committee Service - Handles all committee-related API calls
 */

/**
 * Get available advisors for assignment
 * These are professors/admins who can be assigned to a committee
 *
 * @returns {Promise<{advisors: Array<{userId, email, role, name}>}>}
 */
export const getAvailableAdvisors = async () => {
  try {
    const response = await apiClient.get('/committees/available-advisors');
    return response.data?.advisors || [];
  } catch (error) {
    console.error('Failed to fetch available advisors:', error);
    throw error;
  }
};

/**
 * Assign advisors to a committee (Process 4.2)
 *
 * @param {string} committeeId - Committee ID
 * @param {string[]} advisorIds - Array of advisor user IDs
 * @returns {Promise<{success: boolean, committee: object, message: string}>}
 * @throws {Error} with code property for specific error handling
 *   - 400: Invalid input or advisor validation failed
 *   - 403: User is not coordinator
 *   - 404: Committee not found
 *   - 409: Advisor conflict
 */
export const assignAdvisors = async (committeeId, advisorIds) => {
  try {
    if (!committeeId || !Array.isArray(advisorIds) || advisorIds.length === 0) {
      throw new Error('Committee ID and non-empty advisor list required');
    }

    const response = await apiClient.post(`/committees/${committeeId}/advisors`, {
      advisorIds,
    });

    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || error.message || 'Failed to assign advisors';
    const code = error.response?.status || 500;

    const err = new Error(message);
    err.code = code;
    err.details = error.response?.data || {};

    throw err;
  }
};

/**
 * Get committee details
 *
 * @param {string} committeeId - Committee ID
 * @returns {Promise<{committeeId, committeeName, description, advisorIds, juryIds, status}>}
 */
export const getCommittee = async (committeeId) => {
  try {
    const response = await apiClient.get(`/committees/${committeeId}`);
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch committee ${committeeId}:`, error);
    throw error;
  }
};

/**
 * Get all user-accessible committees based on role
 *
 * @returns {Promise<Array>} List of committees
 */
export const listCommittees = async () => {
  try {
    const response = await apiClient.get('/committees');
    return response.data?.committees || [];
  } catch (error) {
    console.error('Failed to fetch committees:', error);
    throw error;
  }
};

export default {
  getAvailableAdvisors,
  assignAdvisors,
  getCommittee,
  listCommittees,
};
