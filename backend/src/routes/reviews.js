'use strict';

const express = require('express');
const router = express.Router();

const { deliverableAuthMiddleware, roleMiddleware } = require('../middleware/auth');
const reviewController = require('../controllers/reviewController');

// All review routes require a valid JWT; req.user = { userId, role, groupId }
router.use(deliverableAuthMiddleware);

/**
 * POST /api/v1/reviews/assign
 * Process 6.1 — Assign committee members to review a deliverable.
 * Restricted to coordinator role only.
 */
router.post(
  '/assign',
  roleMiddleware(['coordinator']),
  reviewController.assignReview
);

/**
 * GET /api/v1/reviews/status
 * Process 6 — Get current review status for a deliverable.
 * Restricted to coordinator role only.
 */
router.get(
  '/status',
  roleMiddleware(['coordinator']),
  reviewController.getReviewStatus
);

module.exports = router;
