import apiClient from './apiClient';

/**
 * Committee Service — Process 4.1 (Create Committee)
 * OpenAPI: POST /committees
 * DFD Flows: f01 (Coordinator → 4.1), f02 (4.1 → 4.2)
 */

/**
 * Create a new committee draft (Coordinator only)
 * @param {{ committeeName: string, coordinatorId: string, description?: string }} payload
 * @returns {Promise<{ committeeId, committeeName, description, advisorIds, juryIds, status, createdAt }>}
 */
export const createCommittee = async ({ committeeName, coordinatorId, description }) => {
  const response = await apiClient.post('/committees', {
    committeeName,
    coordinatorId,
    description: description || undefined,
  });
  return response.data;
};

/**
 * List all committees (Coordinator / Admin)
 * @returns {Promise<{ committees: object[], total: number }>}
 */
export const listCommittees = async () => {
  const response = await apiClient.get('/committees');
  return response.data;
};

/**
 * Get a single committee by ID
 * @param {string} committeeId
 * @returns {Promise<object>}
 */
export const getCommittee = async (committeeId) => {
  const response = await apiClient.get(`/committees/${committeeId}`);
  return response.data;
};
