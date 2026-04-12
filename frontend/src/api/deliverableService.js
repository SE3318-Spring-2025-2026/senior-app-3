import apiClient from './apiClient';

/**
 * Deliverable Service - Handles deliverable submission API calls.
 */
export const submitDeliverable = async ({ committeeId, groupId, type, storageRef }) => {
  const response = await apiClient.post(`/committees/${committeeId}/deliverables`, {
    groupId,
    type,
    storageRef,
  });
  return response.data;
};

export const getDeliverableByCommittee = async (committeeId) => {
  const response = await apiClient.get(`/committees/${committeeId}/deliverables`);
  return response.data;
};
