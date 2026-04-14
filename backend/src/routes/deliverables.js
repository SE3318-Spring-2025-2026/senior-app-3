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
  listDeliverablesHandler,
  getDeliverableHandler,
  retractDeliverableHandler,
} = require('../controllers/deliverableController');

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
 * Accepted role: student
 * Parses multipart upload (field: "file") before reaching the controller.
 * Controller to be implemented in subsequent Process 5 issues.
 */
router.post(
  '/:stagingId/submit',
  roleMiddleware(['student']),
  uploadSingle('file'),
  (_req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Submit endpoint not yet implemented' });
  }
);

/**
 * DELETE /api/deliverables/:deliverableId/retract
 * Coordinator only. Allowed only when status === 'accepted'.
 * Sets status = 'retracted'; does not delete the file from disk.
 */
router.delete('/:deliverableId/retract', roleMiddleware(['coordinator']), retractDeliverableHandler);

/**
 * POST /api/v1/deliverables/:deliverableId/comments
 * Process 6 — Initiate a review comment on a deliverable.
 * Accessible by committee_member and coordinator. Students may NOT initiate comments.
 */
router.post(
  '/:deliverableId/comments',
  roleMiddleware(['committee_member', 'coordinator']),
  (_req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Comment endpoint not yet implemented' });
  }
);

/**
 * POST /api/v1/deliverables/:deliverableId/comments/:commentId/reply
 * Process 6 — Reply to an existing review comment.
 * Accessible by committee_member, coordinator, and student.
 */
router.post(
  '/:deliverableId/comments/:commentId/reply',
  roleMiddleware(['committee_member', 'coordinator', 'student']),
  (_req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Comment reply endpoint not yet implemented' });
  }
);

module.exports = router;
