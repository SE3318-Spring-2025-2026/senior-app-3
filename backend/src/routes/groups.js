const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { forwardApprovalResults } = require('../controllers/groups');

// POST /api/v1/groups/:groupId/approval-results
// Flow f09: process 2.4 → 2.5 — forward collected approval results to the queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin']),
  forwardApprovalResults
);

module.exports = router;
