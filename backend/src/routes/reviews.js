'use strict';

const express = require('express');
const router = express.Router();

const { deliverableAuthMiddleware, roleMiddleware } = require('../middleware/auth');

// All review routes require a valid JWT; req.user = { userId, role, groupId }
router.use(deliverableAuthMiddleware);

/**
 * POST /api/v1/reviews/assign
 * Process 6 — Assign a reviewer to a deliverable submission.
 * Restricted to coordinator role only.
 */
router.post(
  '/assign',
  roleMiddleware(['coordinator']),
  (_req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Assign review endpoint not yet implemented' });
  }
);

/**
 * GET /api/v1/reviews/status
 * Process 6 — Get current review status for deliverable submissions.
 * Restricted to coordinator role only.
 */
router.get(
  '/status',
  roleMiddleware(['coordinator']),
  (_req, res) => {
    res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Review status endpoint not yet implemented' });
  }
);

module.exports = router;
