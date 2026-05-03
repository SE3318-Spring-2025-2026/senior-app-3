import apiClient from './apiClient';
import { normalizeGroupId } from '../utils/groupId';

/**
 * Process 5.1 — Validate group eligibility and obtain a short-lived validationToken.
 * @param {string} groupId
 * @returns {Promise<{ validationToken: string, groupId: string, committeeId: string }>}
 */
export const validateGroupForSubmission = async (groupId) => {
  const safeGroupId = normalizeGroupId(groupId);
  if (!safeGroupId) {
    throw new Error('Invalid group id');
  }
  const response = await apiClient.post('/deliverables/validate-group', { groupId: safeGroupId });
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
  const safeGroupId = normalizeGroupId(groupId);
  if (!safeGroupId) {
    throw new Error('Invalid group id');
  }
  const { validationToken } = await validateGroupForSubmission(safeGroupId);

  const formData = new FormData();
  formData.append('groupId', safeGroupId);
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
 * @deprecated Use submitDeliverable from ../api/deliverableAPI instead.
 * Retained for test-mock compatibility only. Do not add new callers.
 * @param {string} groupId
 * @param {FormData} formData
 * @returns {Promise<object>}
 */
export const submitDeliverable = async (groupId, formData) => {
  const safeGroupId = normalizeGroupId(groupId);
  if (!safeGroupId) {
    throw new Error('Invalid group id');
  }
  const response = await apiClient.post(`/groups/${safeGroupId}/deliverables`, formData, {
    headers: { 'Content-Type': undefined },
  });
  return response.data;
};

/**
 * Fetch available sprints for a group (used to populate the sprint multi-select).
 * @param {string} groupId
 * @returns {Promise<{ sprints: Array<{ sprintId: string, status: string }>, total: number }>}
 */
export const getGroupSprints = async (groupId) => {
  const safeGroupId = normalizeGroupId(groupId);
  if (!safeGroupId) return { sprints: [], total: 0 };
  try {
    const response = await apiClient.get(`/groups/${safeGroupId}/sprints`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 403 || error.response?.status === 404) {
      return { sprints: [], total: 0 };
    }
    throw error;
  }
};

/**
 * Fetch existing deliverables for a group.
 * @param {string} groupId
 * @returns {Promise<object>}
 */
export const getGroupDeliverables = async (groupId) => {
  const safeGroupId = normalizeGroupId(groupId);
  if (!safeGroupId) {
    return { deliverables: [] };
  }
  // List endpoint lives under /api/v1/deliverables (not GET /groups/:id/deliverables — only POST exists there).
  try {
    const response = await apiClient.get('/deliverables', {
      params: { groupId: safeGroupId, limit: 100, page: 1 },
    });
    const data = response.data || {};
    return {
      deliverables: data.deliverables || [],
      total: data.total,
      page: data.page,
      limit: data.limit,
    };
  } catch (error) {
    if (error.response?.status === 403 || error.response?.status === 404) {
      return { deliverables: [] };
    }
    throw error;
  }
};
