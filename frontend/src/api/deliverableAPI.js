import apiClient from './apiClient';

/**
 * Deliverable API Abstraction Layer
 * Handles the 4-step submission pipeline (5.2 → 5.3 → 5.4 → 5.5)
 */

/**
 * Process 5.2 - Submit deliverable file and create staging record
 * @param {FormData} formData - Contains file, groupId, deliverableType, sprintId, description, etc.
 * @param {string} validationToken - Short-lived token from group validation
 * @returns {Promise<{stagingId: string, fileHash: string, sizeMb: number, mimeType: string}>}
 */
export const submitDeliverable = async (formData, validationToken) => {
  const response = await apiClient.post('/deliverables/submit', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'Authorization-Validation': validationToken,
    },
  });
  return response.data;
};

/**
 * Process 5.3 - Validate file format
 * @param {string} stagingId - ID from submitDeliverable
 * @param {string} validationToken - Short-lived token
 * @returns {Promise<{stagingId: string, validatedAt: string, mimeType: string, code: string}>}
 */
export const validateFormat = async (stagingId, validationToken) => {
  const response = await apiClient.post(
    `/deliverables/${stagingId}/validate-format`,
    {},
    {
      headers: {
        'Authorization-Validation': validationToken,
      },
    }
  );
  return response.data;
};

/**
 * Process 5.4 - Validate deadline compliance
 * @param {string} stagingId - ID from submitDeliverable
 * @param {string} sprintId - Sprint identifier
 * @param {string} validationToken - Short-lived token
 * @returns {Promise<{stagingId: string, sprintId: string, deadlineMet: boolean, code: string}>}
 */
export const validateDeadline = async (stagingId, sprintId, validationToken) => {
  const response = await apiClient.post(
    `/deliverables/${stagingId}/validate-deadline`,
    { sprintId },
    {
      headers: {
        'Authorization-Validation': validationToken,
      },
    }
  );
  return response.data;
};

/**
 * Process 5.5 - Store deliverable permanently in database
 * @param {string} stagingId - ID from submitDeliverable
 * @param {string} validationToken - Short-lived token
 * @returns {Promise<{deliverableId: string, stagingId: string, submittedAt: string, version: string, code: string}>}
 */
export const storeDeliverable = async (stagingId, validationToken) => {
  const response = await apiClient.post(
    `/deliverables/${stagingId}/store`,
    {},
    {
      headers: {
        'Authorization-Validation': validationToken,
      },
    }
  );
  return response.data;
};
