import apiClient from './apiClient';

/**
 * Committee Service - Handles committee assignment API calls.
 */

export const createCommittee = async ({ committeeName, coordinatorId, description }) => {
  const response = await apiClient.post('/committees', {
    committeeName,
    coordinatorId,
    description,
  });
  return response.data;
};

export const assignAdvisors = async (committeeId, advisorIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/advisors`, {
    advisorIds,
  });
  return response.data;
};

export const assignJury = async (committeeId, juryIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/jury`, {
    juryIds,
  });
  return response.data;
};

export const validateCommittee = async (committeeId) => {
  const response = await apiClient.post(`/committees/${committeeId}/validate`);
  return response.data;
};

export const publishCommittee = async (committeeId) => {
  const response = await apiClient.post(`/committees/${committeeId}/publish`);
  return response.data;
};

export const getCommitteeById = async (committeeId) => {
  const response = await apiClient.get(`/committees/${committeeId}`);
  return response.data;
};
