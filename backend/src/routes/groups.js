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

// ============================================================================
// GROUP LIFECYCLE & MANAGEMENT (Process 2.1 - 2.2)
// ============================================================================

// POST /api/v1/groups — Create group record in D2
router.post('/', authMiddleware, roleMiddleware(['student']), createGroup);

// GET /api/v1/groups/pending-invitation — User's pending group invites
router.get('/pending-invitation', authMiddleware, getMyPendingInvitation);

/**
 * POST /api/v1/groups/advisor-sanitization — Process 3.7: Disband unassigned groups
 * Place this before parameterized /:groupId routes to avoid route conflicts.
 * Authorization: Coordinator, Admin or System (automated jobs).
 */
router.post(
  '/advisor-sanitization',
  authMiddleware,
  roleMiddleware(['coordinator', 'system', 'admin']),
  advisorSanitization
);

// GET /api/v1/groups — Coordinator dashboard list
router.get('/', authMiddleware, roleMiddleware(['coordinator']), getAllGroups);

// GET /api/v1/groups/:groupId — Retrieve validated group record
router.get('/:groupId', authMiddleware, getGroup);

// ============================================================================
// MEMBERSHIP & APPROVALS (Process 2.3 - 2.5)
// ============================================================================

router.post('/:groupId/members', authMiddleware, checkScheduleWindow(OPERATION_TYPES.MEMBER_ADDITION), addMember);
router.get('/:groupId/members', authMiddleware, getMembers);
router.post('/:groupId/member-requests', authMiddleware, roleMiddleware(['student']), createMemberRequest);
router.patch('/:groupId/member-requests/:requestId', authMiddleware, decideMemberRequest);
router.post('/:groupId/notifications', authMiddleware, dispatchNotification);
router.post('/:groupId/membership-decisions', authMiddleware, membershipDecision);
router.get('/:groupId/approvals', authMiddleware, getApprovals);

// Flow f09: forward collected approval results to the queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['committee_member', 'professor', 'admin']),
  forwardApprovalResults
);

// ============================================================================
// INTEGRATIONS & OVERRIDES (Process 2.6 - 2.8)
// ============================================================================

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

// ============================================================================
// STATUS & ADVISOR ASSOCIATION (Issue #52, #66, #75)
// ============================================================================

router.get('/:groupId/status', authMiddleware, getStatus);
router.patch(
  '/:groupId/status',
  authMiddleware,
  roleMiddleware(['coordinator', 'committee_member', 'professor', 'admin']),
  transitionStatus
);

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
 * * =====================================================================
 * FIX #3b: REMOVE 'ADMIN' FROM COORDINATOR-ONLY ROUTE (ISSUE #70)
 * Logic: Admin handles system infra, Coordinator handles domain logic.
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
 */
router.patch(
  '/advisor-requests/:requestId',
  authMiddleware,
  roleMiddleware(['professor', 'admin']),
  checkScheduleWindow(OPERATION_TYPES.ADVISOR_ASSOCIATION),
  decideAdvisorRequest
);

module.exports = router;