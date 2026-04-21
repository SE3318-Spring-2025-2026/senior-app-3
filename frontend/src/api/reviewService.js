import apiClient from './apiClient';

/**
 * Review Management API Service
 * Handles all review-related API calls to the backend
 */

/**
 * Assign a review to a deliverable with committee members
 * POST /api/v1/reviews/assign
 * @param {Object} payload - Review assignment data
 * @param {string} payload.deliverableId - Deliverable ID
 * @param {Array<string>} payload.selectedCommitteeMembers - Committee member IDs to assign
 * @param {number} payload.reviewDeadlineDays - Number of days for review deadline
 * @param {string} [payload.instructions] - Optional review instructions
 * @returns {Promise<Object>} Review creation response
 */
export const assignReview = async (payload) => {
  const response = await apiClient.post('/api/v1/reviews/assign', payload);
  return response.data;
};

/**
 * Get all reviews for a coordinator with pagination and filtering
 * GET /api/v1/reviews
 * @param {Object} params - Query parameters
 * @param {number} [params.page] - Page number (1-indexed)
 * @param {number} [params.pageSize] - Items per page
 * @param {string} [params.status] - Filter by review status (pending, in_progress, completed)
 * @param {string} [params.search] - Search by group name
 * @param {string} [params.sortBy] - Field to sort by (deadline, createdAt, status, groupName)
 * @param {string} [params.sortOrder] - Sort order (asc, desc)
 * @returns {Promise<Object>} Reviews list with pagination metadata
 */
export const getReviewsForCoordinator = async (params = {}) => {
  const response = await apiClient.get('/api/v1/reviews', { params });
  return response.data;
};

/**
 * Get detailed information about a specific review
 * GET /api/v1/reviews/:reviewId
 * @param {string} reviewId - Review ID
 * @returns {Promise<Object>} Review details
 */
export const getReviewDetails = async (reviewId) => {
  const response = await apiClient.get(`/api/v1/reviews/${reviewId}`);
  return response.data;
};

/**
 * Get current review status for a deliverable
 * GET /api/v1/reviews/status?deliverableId=:deliverableId
 * @param {string} deliverableId - Deliverable ID
 * @returns {Promise<Object>} Review status information
 */
export const getReviewStatus = async (deliverableId) => {
  const response = await apiClient.get('/api/v1/reviews/status', {
    params: { deliverableId },
  });
  return response.data;
};

/**
 * Update review status
 * PATCH /api/v1/reviews/:reviewId/status
 * @param {string} reviewId - Review ID
 * @param {string} status - New status (pending, in_progress, completed)
 * @returns {Promise<Object>} Updated review
 */
export const updateReviewStatus = async (reviewId, status) => {
  const response = await apiClient.patch(`/api/v1/reviews/${reviewId}/status`, {
    status,
  });
  return response.data;
};

/**
 * Get review comments for a specific review
 * GET /api/v1/reviews/:reviewId/comments
 * @param {string} reviewId - Review ID
 * @returns {Promise<Array>} Comments list
 */
export const getReviewComments = async (reviewId) => {
  const response = await apiClient.get(`/api/v1/reviews/${reviewId}/comments`);
  return response.data;
};

/**
 * Add a comment to a review
 * POST /api/v1/reviews/:reviewId/comments
 * @param {string} reviewId - Review ID
 * @param {Object} payload - Comment data
 * @param {string} payload.text - Comment text
 * @returns {Promise<Object>} Created comment
 */
export const addReviewComment = async (reviewId, payload) => {
  const response = await apiClient.post(
    `/api/v1/reviews/${reviewId}/comments`,
    payload
  );
  return response.data;
};

/**
 * Get assigned members for a review
 * GET /api/v1/reviews/:reviewId/members
 * @param {string} reviewId - Review ID
 * @returns {Promise<Array>} Assigned members list
 */
export const getReviewMembers = async (reviewId) => {
  const response = await apiClient.get(`/api/v1/reviews/${reviewId}/members`);
  return response.data;
};

/**
 * Update member status in a review
 * PATCH /api/v1/reviews/:reviewId/members/:memberId
 * @param {string} reviewId - Review ID
 * @param {string} memberId - Committee member ID
 * @param {Object} payload - Status update data
 * @param {string} payload.status - New status (notified, viewing, submitted)
 * @returns {Promise<Object>} Updated member status
 */
export const updateReviewMemberStatus = async (reviewId, memberId, payload) => {
  const response = await apiClient.patch(
    `/api/v1/reviews/${reviewId}/members/${memberId}`,
    payload
  );
  return response.data;
};

/**
 * Cancel/delete a review assignment
 * DELETE /api/v1/reviews/:reviewId
 * @param {string} reviewId - Review ID
 * @returns {Promise<Object>} Deletion confirmation
 */
export const cancelReview = async (reviewId) => {
  const response = await apiClient.delete(`/api/v1/reviews/${reviewId}`);
  return response.data;
};

export default {
  assignReview,
  getReviewsForCoordinator,
  getReviewDetails,
  getReviewStatus,
  updateReviewStatus,
  getReviewComments,
  addReviewComment,
  getReviewMembers,
  updateReviewMemberStatus,
  cancelReview,
};
