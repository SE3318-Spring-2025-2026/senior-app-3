import apiClient from './apiClient';

/**
 * Submit a deliverable for a group.
 * @param {string} groupId
 * @param {FormData} formData
 * @returns {Promise<object>}
 */
export const submitDeliverable = async (groupId, formData) => {
  const response = await apiClient.post(`/groups/${groupId}/deliverables`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
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
