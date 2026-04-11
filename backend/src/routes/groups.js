const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');
const { forwardApprovalResults, createGroup, getGroup, getAllGroups, createMemberRequest, decideMemberRequest, coordinatorOverride, createAdvisorRequest } = require('../controllers/groups');
const { addMember, getMembers, dispatchNotification, membershipDecision, getMyPendingInvitation, getApprovals } = require('../controllers/groupMembers');
const { configureGithub, getGithub, configureJira, getJira } = require('../controllers/groupIntegrations');
const { transitionStatus, getStatus } = require('../controllers/groupStatusTransition');
const advisorRequestController = require('../controllers/advisorRequestController');

// POST /api/v1/groups — Process 2.1 + 2.2: create, validate, persist, forward to 2.5
router.post('/', authMiddleware, roleMiddleware(['student']), createGroup);

// GET /api/v1/groups/pending-invitation — return current user's pending invitation with group info
router.get('/pending-invitation', authMiddleware, getMyPendingInvitation);

// GET /api/v1/groups — List all groups (coordinator only) for group management dashboard
router.get('/', authMiddleware, roleMiddleware(['coordinator']), getAllGroups);

// POST /api/v1/groups/:groupId/release-advisor — Team Leader releases assigned advisor (transactional)
router.post('/:groupId/release-advisor', authMiddleware, advisorRequestController.releaseAdvisor);

// GET /api/v1/groups/:groupId — Process 2.2: retrieve validated group record from D2
router.get('/:groupId', authMiddleware, getGroup);

// POST /api/v1/groups/:groupId/members — Process 2.3: leader invites a student (f05, f19)
router.post('/:groupId/members', authMiddleware, checkScheduleWindow('member_addition'), addMember);

// GET /api/v1/groups/:groupId/members — return current member list from D2
router.get('/:groupId/members', authMiddleware, getMembers);

// POST /api/v1/groups/:groupId/member-requests — Student requests to join group
router.post('/:groupId/member-requests', authMiddleware, roleMiddleware(['student']), createMemberRequest);

// PATCH /api/v1/groups/:groupId/member-requests/:requestId — Leader approves/rejects member request
router.patch('/:groupId/member-requests/:requestId', authMiddleware, decideMemberRequest);

// POST /api/v1/groups/:groupId/notifications — Process 2.3: dispatch invitation notification (f06)
router.post('/:groupId/notifications', authMiddleware, dispatchNotification);

// POST /api/v1/groups/:groupId/membership-decisions — Process 2.4: student accepts/rejects (f07, f08)
router.post('/:groupId/membership-decisions', authMiddleware, membershipDecision);

// GET /api/v1/groups/:groupId/approvals — Process 2.4: list all invitation decisions with overall_status
router.get('/:groupId/approvals', authMiddleware, getApprovals);

// POST /api/v1/groups/:groupId/approval-results
// Flow f09: process 2.4 → 2.5 — forward collected approval results to the queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin']),
  forwardApprovalResults
);

// POST /api/v1/groups/:groupId/advisor-requests — Process 3.2: group leader requests advisor
// Input: { professorId, message? }
// Process: Validate group/professor, create advisor request record, dispatch notification (Process 3.3)
router.post(
  '/:groupId/advisor-requests',
  authMiddleware,
  roleMiddleware(['student']),
  checkScheduleWindow('advisor_association'),
  createAdvisorRequest
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

// GET /api/v1/groups/:groupId/status — Issue #52: Retrieve current group status
router.get(
  '/:groupId/status',
  authMiddleware,
  getStatus
);

// PATCH /api/v1/groups/:groupId/status — Issue #52: Transition group to new status
// Allowed transitions: pending_validation→active/rejected, active→inactive/rejected, inactive→active/rejected
router.patch(
  '/:groupId/status',
  authMiddleware,
  roleMiddleware(['coordinator', 'committee_member', 'professor', 'admin']),
  transitionStatus
);

module.exports = router;
