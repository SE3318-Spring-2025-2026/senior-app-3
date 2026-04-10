import apiClient from './apiClient';

/**
 * Committee Service
 * Process 4.1 (Create Committee) — Process 4.3 (Add Jury Members)
 * OpenAPI: POST /committees  |  POST /committees/{id}/jury
 * DFD Flows: f01 (Coordinator → 4.1), f02 (4.1 → 4.2),
 *            f10 (Coordinator → 4.3), f04 (4.3 → 4.4)
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

/**
 * Assign advisors to a committee
 * @param {string} committeeId
 * @param {string[]} advisorIds
 * @returns {Promise<object>}
 */
export const assignCommitteeAdvisors = async (committeeId, advisorIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/advisors`, {
    advisorIds,
  });
  return response.data;
};

/**
 * Process 4.3 — Assign jury members to a committee draft
 * OpenAPI: POST /committees/{committeeId}/jury
 * DFD Flow f10 (Coordinator → 4.3), f04 (4.3 → 4.4)
 *
 * @param {string} committeeId
 * @param {string[]} juryIds  — array of professor userId strings
 * @returns {Promise<object>}  — updated committee object with full juryIds[]
 */
export const addJuryMembers = async (committeeId, juryIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/jury`, {
    juryIds,
  });
  return response.data;
};

/**
 * Fetch the list of professors available for jury assignment
 * Reuses the existing auth/users endpoint, filtered by role=professor
 * @returns {Promise<object[]>}
 */
export const getProfessorsForJury = async () => {
  const response = await apiClient.get('/auth/users/professors');
  return response.data.professors || [];
};
