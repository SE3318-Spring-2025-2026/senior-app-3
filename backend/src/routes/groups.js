const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { forwardApprovalResults, createGroup, getGroup, createMemberRequest, decideMemberRequest } = require('../controllers/groups');

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

// POST /api/v1/groups/:groupId/member-requests
// Process 2.5: Student submits a membership request (Issue #34 — Add Team Members)
// Flow f20: 2.5 reads D2 to reconcile state; new pending record written to D2
router.post('/:groupId/member-requests', authMiddleware, createMemberRequest);

// PATCH /api/v1/groups/:groupId/member-requests/:requestId
// Process 2.5: Approve or reject a pending membership request
// Flow f09 (normal approval from 2.4) and f17 (override from 2.8, is_override: true)
// Flow f04: on approval, group-created confirmation is sent to the Student
router.patch(
  '/:groupId/member-requests/:requestId',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin', 'coordinator']),
  decideMemberRequest
);

module.exports = router;
