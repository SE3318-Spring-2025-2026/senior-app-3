const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { committeeLimiter } = require('../middleware/committeeLimiter');
const {
  createCommittee,
  listCommittees,
  getCommittee,
  publishCommittee,
  assignAdvisorsToCommittee
} = require('../controllers/committees');

/**
 * GET /api/v1/committees
 * Process 4.4: List all committees (Coordinator / Admin visibility)
 */
router.get(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  listCommittees
);

/**
 * POST /api/v1/committees
 * Process 4.1: Coordinator creates a committee draft (f01, f02)
 * Security: Rate limited to prevent resource exhaustion
 */
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator']),
  committeeLimiter,
  createCommittee
);

/**
 * GET /api/v1/committees/:committeeId
 * Process 4.4: Retrieve a single committee record from D3
 */
router.get(
  '/:committeeId',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getCommittee
);

/**
 * POST /api/v1/committees/:committeeId/advisors
 * Process 4.2: Assign advisors to the committee draft
 */
router.post(
  '/:committeeId/advisors',
  authMiddleware,
  roleMiddleware(['coordinator']),
  assignAdvisorsToCommittee
);

/**
 * POST /api/v1/committees/:committeeId/publish
 * Process 4.5: Finalize and publish the committee (f10)
 */
router.post(
  '/:committeeId/publish',
  authMiddleware,
  roleMiddleware(['coordinator']),
  publishCommittee
);

module.exports = router;