import apiClient from './apiClient';

/**
 * Review API Abstraction Layer
 * Handles deliverable review workflows including comments and replies
 */

/**
 * GET /api/v1/deliverables/:deliverableId
 * Fetch deliverable details for review
 */
export const getDeliverableDetails = async (deliverableId) => {
  const response = await apiClient.get(`/deliverables/${deliverableId}`);
  return response.data;
};

/**
 * GET /api/v1/comments
 * Fetch all comments for a deliverable
 * @param {string} deliverableId - ID of the deliverable
 * @param {Object} options - Query parameters
 * @param {number} options.page - Page number (default 1)
 * @param {number} options.limit - Comments per page (default 10)
 * @param {string} options.status - Filter by status: 'open', 'resolved', 'acknowledged'
 * @returns {Promise<{comments: Array, total: number, page: number, limit: number, totalPages: number, openClarificationCount: number}>}
 */
export const getComments = async (deliverableId, options = {}) => {
  const params = new URLSearchParams({
    deliverableId,
    page: options.page || 1,
    limit: options.limit || 10,
    ...(options.status && { status: options.status }),
  });

  const response = await apiClient.get(`/comments?${params.toString()}`);
  return response.data;
};

/**
 * POST /api/v1/comments
 * Add a new comment to a deliverable review
 * @param {Object} data - Comment data
 * @param {string} data.deliverableId - ID of the deliverable
 * @param {string} data.content - Comment content (1-5000 chars)
 * @param {string} data.commentType - Type: 'general', 'question', 'clarification_required', 'suggestion', 'praise'
 * @param {number} data.sectionNumber - Optional section number
 * @param {boolean} data.needsResponse - Whether response is needed (clarification_required only)
 * @returns {Promise<{commentId: string, ...comment}>}
 */
export const addComment = async (data) => {
  const response = await apiClient.post('/comments', data);
  return response.data;
};

/**
 * PATCH /api/v1/comments/:commentId
 * Edit a comment (author only)
 * @param {string} commentId - ID of the comment to edit
 * @param {string} content - New comment content
 * @returns {Promise<{commentId: string, ...comment}>}
 */
export const editComment = async (commentId, content) => {
  const response = await apiClient.patch(`/comments/${commentId}`, { content });
  return response.data;
};

/**
 * PATCH /api/v1/comments/:commentId/resolve
 * Resolve a comment (mark as resolved)
 * @param {string} commentId - ID of the comment to resolve
 * @returns {Promise<{commentId: string, status: 'resolved', ...comment}>}
 */
export const resolveComment = async (commentId) => {
  const response = await apiClient.patch(`/comments/${commentId}/resolve`);
  return response.data;
};

/**
 * POST /api/v1/comments/:commentId/reply
 * Add a reply to a comment
 * @param {string} commentId - ID of the comment to reply to
 * @param {string} content - Reply content (1-2000 chars)
 * @returns {Promise<{replyId: string, ...reply}>}
 */
export const addReply = async (commentId, content) => {
  const response = await apiClient.post(`/comments/${commentId}/reply`, { content });
  return response.data;
};

/**
 * GET /api/v1/reviews/status
 * Fetch review management dashboard statistics
 * @returns {Promise<{pending: number, in_progress: number, needs_clarification: number, completed: number, reviews: Array}>}
 */
export const getReviewStatus = async () => {
  const response = await apiClient.get('/reviews/status');
  return response.data;
};

/**
 * POST /api/v1/reviews/assign
 * Assign reviewers to a deliverable
 * @param {Object} data - Assignment data
 * @param {string} data.deliverableId - ID of the deliverable to assign
 * @param {number} data.reviewDeadlineDays - Number of days until review deadline (1-30)
 * @param {Array<string>} data.selectedCommitteeMembers - Array of committee member IDs (optional)
 * @param {string} data.instructions - Review instructions (optional)
 * @returns {Promise<{reviewAssignmentId: string, deliverableId: string, assignedCount: number, deadline: string}>}
 */
export const assignReview = async (data) => {
  const response = await apiClient.post('/reviews/assign', data);
  return response.data;
};

/**
 * GET /api/v1/reviews
 * Fetch all reviews with optional filtering
 * @param {Object} options - Query parameters
 * @param {string} options.status - Filter by status: 'pending', 'in_progress', 'needs_clarification', 'completed'
 * @param {number} options.page - Page number (default 1)
 * @param {number} options.limit - Items per page (default 20)
 * @returns {Promise<{reviews: Array, total: number, page: number, limit: number, totalPages: number}>}
 */
export const getReviews = async (options = {}) => {
  const params = new URLSearchParams({
    page: options.page || 1,
    limit: options.limit || 20,
    ...(options.status && { status: options.status }),
  });

  const response = await apiClient.get(`/reviews?${params.toString()}`);
  return response.data;
};

/**
 * GET /api/v1/committees/candidates
 * Fetch list of available committee members for assignment
 * @returns {Promise<{candidates: Array<{id: string, name: string, email: string}>}>}
 */
export const getCommitteeCandidates = async () => {
  const response = await apiClient.get('/committees/candidates');
  return response.data;
};

/**
 * GET /api/v1/deliverables/:deliverableId/download
 * Download the stored file for a deliverable
 * @param {string} deliverableId
 * @returns {Promise<AxiosResponse>} Response with blob data
 */
export const downloadDeliverable = async (deliverableId) => {
  const response = await apiClient.get(`/deliverables/${deliverableId}/download`, {
    responseType: 'blob',
  });
  return response;
};

export default {
  getDeliverableDetails,
  getComments,
  addComment,
  editComment,
  resolveComment,
  addReply,
  getReviewStatus,
  assignReview,
  getReviews,
  getCommitteeCandidates,
  downloadDeliverable,
};
