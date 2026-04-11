import apiClient from './apiClient';

export const getProfessorAdvisorRequests = async () => {
  const response = await apiClient.get('/advisor-requests/mine');
  return response.data;
};

export const decideAdvisorRequest = async (requestId, { decision, reason }) => {
  const response = await apiClient.patch(`/advisor-requests/${requestId}`, {
    decision,
    reason: reason || undefined,
  });
  return response.data;
};

export default {
  getProfessorAdvisorRequests,
  decideAdvisorRequest,
};
