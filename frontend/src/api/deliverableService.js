import apiClient from './apiClient';

/**
 * Process 5.1 — Validate group eligibility and obtain a short-lived validationToken.
 * @param {string} groupId
 * @returns {Promise<{ validationToken: string, groupId: string, committeeId: string }>}
 */
export const validateGroupForSubmission = async (groupId) => {
  const response = await apiClient.post('/deliverables/validate-group', { groupId });
  return response.data;
};

/**
 * Process 5.2 — Submit a deliverable file and create a staging record.
 * Calls validate-group first to get a validationToken, then submits the file.
 *
 * @param {string} groupId
 * @param {{ deliverableType: string, sprintId: string, file: File, description?: string }} params
 * @returns {Promise<{ stagingId: string, fileHash: string, sizeMb: number, mimeType: string, nextStep: string }>}
 */
export const submitDeliverableStaging = async (groupId, { deliverableType, sprintId, file, description }) => {
  const { validationToken } = await validateGroupForSubmission(groupId);

  const formData = new FormData();
  formData.append('groupId', groupId);
  formData.append('deliverableType', deliverableType);
  formData.append('sprintId', sprintId);
  formData.append('file', file);
  if (description) formData.append('description', description);

  const response = await apiClient.post('/deliverables/submit', formData, {
    headers: {
      'Content-Type': undefined,
      'Authorization-Validation': validationToken,
    },
  });
  return response.data;
};

/**
 * Legacy: Submit a deliverable for a group (old endpoint).
 * @param {string} groupId
 * @param {FormData} formData
 * @returns {Promise<object>}
 */
export const submitDeliverable = async (groupId, formData) => {
  const response = await apiClient.post(`/groups/${groupId}/deliverables`, formData, {
    headers: { 'Content-Type': undefined },
  });
  return response.data;
};

/**
 * Fetch existing deliverables for a group.
 * @param {string} groupId
 * @returns {Promise<object>}
 */
export const getGroupDeliverables = async (groupId) => {
  const response = await apiClient.get(`/groups/${groupId}/deliverables`);
  return response.data;
};
