const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { forwardApprovalResults, createGroup, getGroup } = require('../controllers/groups');

// POST /api/v1/groups — Process 2.1 + 2.2: create, validate, persist, forward to 2.5
router.post('/', authMiddleware, createGroup);

// GET /api/v1/groups/:groupId — Process 2.2: retrieve validated group record from D2
router.get('/:groupId', authMiddleware, getGroup);

// POST /api/v1/groups/:groupId/approval-results
// Flow f09: process 2.4 → 2.5 — forward collected approval results to the queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin']),
  forwardApprovalResults
);

module.exports = router;
