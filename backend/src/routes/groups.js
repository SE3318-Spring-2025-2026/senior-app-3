const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow, checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');

// Controllers
const {
  forwardApprovalResults,
  createGroup,
  getGroup,
  getAllGroups,
  createMemberRequest,
  decideMemberRequest,
  coordinatorOverride,
} = require('../controllers/groups');

const { 
  addMember, 
  getMembers, 
  dispatchNotification, 
  membershipDecision, 
  getMyPendingInvitation, 
  getApprovals 
} = require('../controllers/groupMembers');

const { configureGithub, getGithub, configureJira, getJira } = require('../controllers/groupIntegrations');
const { transitionStatus, getStatus } = require('../controllers/groupStatusTransition');
const { releaseAdvisor, transferAdvisor } = require('../controllers/advisorAssociation');
const { decideAdvisorRequest } = require('../controllers/advisorDecision');
const { advisorSanitization } = require('../controllers/sanitizationController');

// --- Group Lifecycle (Process 2.1 - 2.2) ---

// POST /api/v1/groups — Create group record in D2
router.post('/', authMiddleware, roleMiddleware(['student']), createGroup);

// GET /api/v1/groups/pending-invitation — User's pending group invites
router.get('/pending-invitation', authMiddleware, getMyPendingInvitation);

// GET /api/v1/groups — Coordinator dashboard list
router.get('/', authMiddleware, roleMiddleware(['coordinator']), getAllGroups);

// POST /api/v1/groups/advisor-sanitization — Process 3.7: Disband unassigned groups
// Note: Registered before /:groupId to prevent route collision
router.post(
  '/advisor-sanitization',
  authMiddleware,
  roleMiddleware(['coordinator', 'system', 'admin']),
  advisorSanitization
);

// GET /api/v1/groups/:groupId — Retrieve validated group record
router.get('/:groupId', authMiddleware, getGroup);

// --- Membership Management (Process 2.3 - 2.5) ---

// POST /api/v1/groups/:groupId/members — Invite a student
router.post('/:groupId/members', authMiddleware, checkScheduleWindow(OPERATION_TYPES.MEMBER_ADDITION), addMember);

// GET /api/v1/groups/:groupId/members — List current members
router.get('/:groupId/members', authMiddleware, getMembers);

// POST /api/v1/groups/:groupId/member-requests — Student self-request to join
router.post('/:groupId/member-requests', authMiddleware, roleMiddleware(['student']), createMemberRequest);

// PATCH /api/v1/groups/:groupId/member-requests/:requestId — Leader decision
router.patch('/:groupId/member-requests/:requestId', authMiddleware, decideMemberRequest);

// POST /api/v1/groups/:groupId/notifications — Dispatch invitation (f06)
router.post('/:groupId/notifications', authMiddleware, dispatchNotification);

// POST /api/v1/groups/:groupId/membership-decisions — Accept/Reject invite
router.post('/:groupId/membership-decisions', authMiddleware, membershipDecision);

// GET /api/v1/groups/:groupId/approvals — List decision status
router.get('/:groupId/approvals', authMiddleware, getApprovals);

// POST /api/v1/groups/:groupId/approval-results — Forward results to Process 2.5 queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin']),
  forwardApprovalResults
);

// --- Integrations & Overrides (Process 2.6 - 2.8) ---

router.post('/:groupId/github', authMiddleware, configureGithub);
router.get('/:groupId/github', authMiddleware, getGithub);
router.post('/:groupId/jira', authMiddleware, configureJira);
router.get('/:groupId/jira', authMiddleware, getJira);

router.patch(
  '/:groupId/override',
  authMiddleware,
  roleMiddleware(['coordinator']),
  coordinatorOverride
);

// --- Status Management (Issue #52) ---

router.get('/:groupId/status', authMiddleware, getStatus);
router.patch(
  '/:groupId/status',
  authMiddleware,
  roleMiddleware(['coordinator', 'committee_member', 'professor', 'admin']),
  transitionStatus
);

// --- Advisor Association Workflow (Process 3.0 — Level 2.3 / Issue #75) ---

/**
 * DELETE /api/v1/groups/:groupId/advisor — Process 3.5: Release current advisor
 * Schedule: Subject to advisor_release window enforcement (422 if outside)
 */
router.delete(
  '/:groupId/advisor',
  authMiddleware,
  roleMiddleware(['student', 'coordinator']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_RELEASE),
  releaseAdvisor
);

/**
 * POST /api/v1/groups/:groupId/advisor/transfer — Process 3.6: Coordinator transfer
 * Schedule: Subject to advisor_transfer window enforcement (422 if outside)
 * * =====================================================================
 * FIX #3b: REMOVE 'ADMIN' FROM COORDINATOR-ONLY ROUTE (ISSUE #70 - HIGH)
 * =====================================================================
 * Process 3.6 is explicitly defined as COORDINATOR-ONLY per DFD.
 * Admin users are restricted to system operations, not domain logic.
 * =====================================================================
 */
router.post(
  '/:groupId/advisor/transfer',
  authMiddleware,
  roleMiddleware(['coordinator']), 
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_TRANSFER),
  transferAdvisor
);

/**
 * PATCH /api/v1/groups/advisor-requests/:requestId — Process 3.4: Professor decision
 * (Note: Moved here from root for group context consistency)
 */
router.patch(
  '/advisor-requests/:requestId',
  authMiddleware,
  roleMiddleware(['professor', 'admin']),
  checkScheduleWindow(OPERATION_TYPES.ADVISOR_ASSOCIATION),
  decideAdvisorRequest
);

module.exports = router;