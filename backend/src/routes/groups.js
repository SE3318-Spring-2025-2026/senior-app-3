const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { forwardApprovalResults, createGroup, getGroup, createMemberRequest, decideMemberRequest, coordinatorOverride } = require('../controllers/groups');
const { addMember, getMembers, dispatchNotification, membershipDecision } = require('../controllers/groupMembers');
const { configureGithub, getGithub, configureJira, getJira } = require('../controllers/groupIntegrations');

// POST /api/v1/groups — Process 2.1 + 2.2: create, validate, persist, forward to 2.5
router.post('/', authMiddleware, roleMiddleware(['student']), createGroup);

// GET /api/v1/groups/:groupId — Process 2.2: retrieve validated group record from D2
router.get('/:groupId', authMiddleware, getGroup);

// POST /api/v1/groups/:groupId/members — Process 2.3: leader invites a student (f05, f19)
router.post('/:groupId/members', authMiddleware, addMember);

// GET /api/v1/groups/:groupId/members — return current member list from D2
router.get('/:groupId/members', authMiddleware, getMembers);

// POST /api/v1/groups/:groupId/notifications — Process 2.3: dispatch invitation notification (f06)
router.post('/:groupId/notifications', authMiddleware, dispatchNotification);

// POST /api/v1/groups/:groupId/membership-decisions — Process 2.4: student accepts/rejects (f07, f08)
router.post('/:groupId/membership-decisions', authMiddleware, membershipDecision);

// POST /api/v1/groups/:groupId/approval-results
// Flow f09: process 2.4 → 2.5 — forward collected approval results to the queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin']),
  forwardApprovalResults
);

// POST /api/v1/groups/:groupId/github — Process 2.6: validate PAT + org, store config (f10-f12, f24)
router.post('/:groupId/github', authMiddleware, configureGithub);

// GET /api/v1/groups/:groupId/github — return stored GitHub config
router.get('/:groupId/github', authMiddleware, getGithub);

// POST /api/v1/groups/:groupId/jira — Process 2.7: validate credentials + project key (f13-f15, f25)
router.post('/:groupId/jira', authMiddleware, configureJira);

// GET /api/v1/groups/:groupId/jira — return stored JIRA config
router.get('/:groupId/jira', authMiddleware, getJira);

// PATCH /api/v1/groups/:groupId/override
// Process 2.8: Coordinator override — add/remove member, bypassing standard flow
router.patch(
  '/:groupId/override',
  authMiddleware,
  roleMiddleware(['coordinator']),
  coordinatorOverride
);

module.exports = router;
