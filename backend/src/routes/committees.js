const express = require('express');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { assignAdvisorsToCmte } = require('../controllers/committeeAdvisor');

const router = express.Router();

/**
 * POST /api/v1/committees/:committeeId/advisors
 *
 * Assign one or more advisors to a committee draft
 * Requires: coordinator role
 * Returns: updated Committee object with populated advisorIds[]
 */
router.post(
  '/:committeeId/advisors',
  authMiddleware,
  roleMiddleware(['coordinator']),
  assignAdvisorsToCmte
);

module.exports = router;
