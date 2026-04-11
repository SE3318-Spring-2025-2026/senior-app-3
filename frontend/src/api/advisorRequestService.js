import apiClient from './apiClient';

const advisorRequestService = {
  getMyRequests: async () => {
    const response = await apiClient.get('/advisor-requests/mine');
    return response.data.requests || [];
  },

  decideOnRequest: async (requestId, decision, reason) => {
    const response = await apiClient.patch(`/advisor-requests/${requestId}`, {
      decision,
      reason: reason || null,
    });
    return response.data;
  },
};

export default advisorRequestService;
