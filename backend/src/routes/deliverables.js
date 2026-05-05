'use strict';

const express = require('express');
const router = express.Router();

const { deliverableAuthMiddleware, roleMiddleware } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');
const {
  validateGroup,
  submitDeliverable,
  validateFormatHandler,
  validateDeadlineHandler,
  storeDeliverableHandler,
  submitFinalizeHandler,
  listDeliverablesHandler,
  getDeliverableHandler,
  retractDeliverableHandler,
  notifyDeliverableHandler,
  downloadDeliverableHandler,
} = require('../controllers/deliverableController');
const { updateCommentHandler, replyToCommentHandler } = require('../controllers/reviewController');
const { addComment, getComments } = require('../controllers/reviewController');

// All deliverable routes require a valid JWT; req.user = { userId, role, groupId }
router.use(deliverableAuthMiddleware);

/**
 * GET /api/deliverables
 * List deliverables for a group with optional filters and pagination.
 * Students see their own group only; coordinators may query any group.
 */
router.get('/', listDeliverablesHandler);

/**
 * GET /api/deliverables/:deliverableId
 * Full deliverable record including validationHistory.
 * Students can only view deliverables belonging to their own group.
 */
router.get('/:deliverableId', getDeliverableHandler);

/**
 * GET /api/deliverables/:deliverableId/download
 * Stream the stored file to the requester.
 * Students may only download deliverables belonging to their own group.
 */
router.get('/:deliverableId/download', downloadDeliverableHandler);

/**
 * POST /api/deliverables/validate-group
 * Process 5.1 — Gate check: active group + committee assigned.
 * Returns a short-lived validationToken (JWT, 15 min) on success.
 */
router.post('/validate-group', roleMiddleware(['student']), validateGroup);

/**
 * POST /api/deliverables/submit
 * Process 5.2 — Accept file upload and create a staging record.
 * Requires: JWT (student), multipart/form-data with file field,
 * and a valid Authorization-Validation token from Process 5.1.
 * Returns 202 with stagingId on success.
 */
router.post(
  '/submit',
  roleMiddleware(['student']),
  uploadSingle('file'),
  submitDeliverable
);

/**
 * POST /api/deliverables/:stagingId/validate-format
 * Process 5.3 — Validate staged file format and size.
 */
router.post(
  '/:stagingId/validate-format',
  roleMiddleware(['student']),
  validateFormatHandler
);

/**
 * POST /api/deliverables/:stagingId/validate-deadline
 * Process 5.4 — Validate submission deadline and team requirements.
 * Staging record must be in 'format_validated' status.
 */
router.post(
  '/:stagingId/validate-deadline',
  roleMiddleware(['student']),
  validateDeadlineHandler
);

/**
 * POST /api/deliverables/:stagingId/submit
 * Process 5.2–5.5 combined — runs format validation, deadline validation, and
 * permanent storage in a single call for an already-staged deliverable.
 * Accepted role: student
 */
router.post(
  '/:stagingId/submit',
  roleMiddleware(['student']),
  submitFinalizeHandler
);

/**
 * POST /api/deliverables/:stagingId/store
 * Process 5.5 — Move staged file to permanent storage and create the final Deliverable record.
 * Requires JWT (student role). Staging record must be in 'requirements_validated' status.
 * Returns 201 on success; 507 if disk is full (staging record preserved for retry).
 */
router.post(
  '/:stagingId/store',
  roleMiddleware(['student']),
  storeDeliverableHandler
);

/**
 * DELETE /api/deliverables/:deliverableId/retract
 * Coordinator only. Allowed only when status === 'accepted'.
 * Sets status = 'retracted'; does not delete the file from disk.
 */
router.delete('/:deliverableId/retract', roleMiddleware(['coordinator']), retractDeliverableHandler);

/**
 * POST /api/deliverables/:deliverableId/notify
 * Process 5.6 — Queue post-submission notifications to committee, coordinator, and students.
 * Requires JWT. Returns 202 immediately; notifications are delivered asynchronously.
 * Returns 409 if notifications have already been sent (notifiedAt is set).
 */
router.post('/:deliverableId/notify', notifyDeliverableHandler);

/**
 * POST /api/deliverables/:deliverableId/comments
 * Process 6.2 — Add a comment (general or clarification request) to a deliverable.
 * Accessible by committee_member and coordinator. Students may NOT initiate comments.
 */
router.post(
  '/:deliverableId/comments',
  roleMiddleware(['committee_member', 'coordinator']),
  addComment
);

/**
 * GET /api/deliverables/:deliverableId/comments
 * Process 6.2 — Retrieve the full comment thread for a deliverable.
 * Accessible by any authenticated role; students may only view their own group's deliverables.
 */
router.get('/:deliverableId/comments', getComments);

/**
 * PATCH /api/v1/deliverables/:deliverableId/comments/:commentId
 * Process 6.2 — Edit content or update status of a comment.
 * Accessible by committee_member, coordinator, and student.
 */
router.patch(
  '/:deliverableId/comments/:commentId',
  roleMiddleware(['committee_member', 'coordinator', 'student']),
  updateCommentHandler
);

/**
 * POST /api/v1/deliverables/:deliverableId/comments/:commentId/reply
 * Process 6 — Reply to an existing review comment.
 * Accessible by committee_member, coordinator, and student.
 */
router.post(
  '/:deliverableId/comments/:commentId/reply',
  roleMiddleware(['committee_member', 'coordinator', 'student']),
  replyToCommentHandler
);

module.exports = router;
