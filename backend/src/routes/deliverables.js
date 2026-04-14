'use strict';

const express = require('express');
const router = express.Router();

const { deliverableAuthMiddleware, roleMiddleware } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');
const { validateGroup, submitDeliverable, validateFormatHandler, validateDeadlineHandler } = require('../controllers/deliverableController');

// All deliverable routes require a valid JWT; req.user = { userId, role, groupId }
router.use(deliverableAuthMiddleware);

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
 * Accepted role: coordinator
 * Controller to be implemented in subsequent Process 5 issues.
 */
router.delete(
  '/:deliverableId/retract',
  roleMiddleware(['coordinator']),
  (_req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Retract endpoint not yet implemented' });
  }
);

module.exports = router;
