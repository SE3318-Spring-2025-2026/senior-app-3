import apiClient from './apiClient';

/**
 * Fetch the read-only final grade review snapshot for professor/advisor oversight.
 *
 * Expected backend endpoint:
 * GET /groups/{groupId}/final-grades/review
 */
export const getFinalGradeReview = async (groupId) => {
  const response = await apiClient.get(`/groups/${groupId}/final-grades/review`);
  return response.data;
};

