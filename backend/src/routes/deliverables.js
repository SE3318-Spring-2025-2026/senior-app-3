'use strict';

const express = require('express');
const router = express.Router();

const { deliverableAuthMiddleware, roleMiddleware } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');
const { validateGroup } = require('../controllers/deliverableController');

// All deliverable routes require a valid JWT; req.user = { userId, role, groupId }
router.use(deliverableAuthMiddleware);

/**
 * POST /api/deliverables/validate-group
 * Process 5.1 — Gate check: active group + committee assigned.
 * Returns a short-lived validationToken (JWT, 15 min) on success.
 */
router.post('/validate-group', roleMiddleware(['student']), validateGroup);

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
  (req, res) => {
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
  (req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Retract endpoint not yet implemented' });
  }
);

module.exports = router;
