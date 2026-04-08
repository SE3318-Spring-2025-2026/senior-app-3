import apiClient from './apiClient';

export const listCommittees = async () => {
  const response = await apiClient.get('/committees');
  return response.data;
};

export const listCommitteeCandidates = async () => {
  const response = await apiClient.get('/committees/candidates');
  return response.data;
};

export const createCommittee = async ({ committeeName, description, coordinatorId }) => {
  const response = await apiClient.post('/committees', {
    committeeName,
    description,
    coordinatorId,
  });
  return response.data;
};

export const assignCommitteeAdvisors = async (committeeId, advisorIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/advisors`, {
    advisorIds,
  });
  return response.data;
};

export const addCommitteeJuryMembers = async (committeeId, juryIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/jury`, {
    juryIds,
  });
  return response.data;
};

export const validateCommitteeSetup = async (committeeId) => {
  const response = await apiClient.post(`/committees/${committeeId}/validate`);
  return response.data;
};

export const publishCommittee = async (committeeId) => {
  const response = await apiClient.post(`/committees/${committeeId}/publish`);
  return response.data;
};
