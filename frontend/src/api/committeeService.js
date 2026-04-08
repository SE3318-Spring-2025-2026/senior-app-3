import apiClient from './apiClient';

export const getCommittees = async () => {
  const response = await apiClient.get('/committees');
  return response.data;
};

export const getCommittee = async (committeeId) => {
  const response = await apiClient.get(`/committees/${committeeId}`);
  return response.data;
};

export const addJuryMembers = async (committeeId, juryIds) => {
  const response = await apiClient.post(`/committees/${committeeId}/jury`, {
    juryIds,
  });
  return response.data;
};
