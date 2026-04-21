'use strict';

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
  getSprintContributionSummary,
  createMemberRequest,
  decideMemberRequest,
  coordinatorOverride,
  transferAdvisor
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

// Integrated Controllers from both branches
const { getGroupCommitteeStatus } = require('../controllers/committees'); // From your branch
const { submitDeliverableHandler } = require('../controllers/deliverables'); // From main
const { releaseAdvisor } = require('../controllers/advisorAssociation'); // From main
const { advisorSanitization } = require('../controllers/sanitizationController'); // From main

// ============================================================================
// GROUP LIFECYCLE & MANAGEMENT (Process 2.1 - 2.2)
// ============================================================================

// POST /api/v1/groups — Student group creation
router.post(
  '/', 
  authMiddleware, 
  roleMiddleware(['student']), 
  checkScheduleWindow(OPERATION_TYPES.GROUP_CREATION),
  createGroup
);

// GET /api/v1/groups/pending-invitation — User's pending group invites
router.get('/pending-invitation', authMiddleware, getMyPendingInvitation);

/**
 * POST /api/v1/groups/advisor-sanitization — Process 3.7: Disband unassigned groups
 */
router.post(
  '/advisor-sanitization',
  authMiddleware,
  roleMiddleware(['coordinator', 'system', 'admin']),
  advisorSanitization
);

// GET /api/v1/groups — Coordinator dashboard list
router.get('/', authMiddleware, roleMiddleware(['coordinator']), getAllGroups);

// GET /api/v1/groups/:groupId — Detailed group record
router.get('/:groupId', authMiddleware, getGroup);

/**
 * GET /api/v1/groups/:groupId/committee-status — Committee status lookup (From your branch)
 */
router.get('/:groupId/committee-status', authMiddleware, getGroupCommitteeStatus);

// GET /api/v1/groups/:groupId/sprints/:sprintId/contributions — read-only Process 7.x summary
router.get(
  '/:groupId/sprints/:sprintId/contributions',
  authMiddleware,
  roleMiddleware(['professor', 'advisor', 'committee_member']),
  getSprintContributionSummary
);

// ============================================================================
// MEMBERSHIP & APPROVALS (Process 2.3 - 2.5)
// ============================================================================

router.post(
  '/:groupId/members', 
  authMiddleware, 
  checkScheduleWindow(OPERATION_TYPES.MEMBER_ADDITION), 
  addMember
);

router.get('/:groupId/members', authMiddleware, getMembers);
router.post('/:groupId/member-requests', authMiddleware, roleMiddleware(['student']), createMemberRequest);
router.patch('/:groupId/member-requests/:requestId', authMiddleware, decideMemberRequest);
router.post('/:groupId/notifications', authMiddleware, dispatchNotification);
router.post('/:groupId/membership-decisions', authMiddleware, membershipDecision);
router.get('/:groupId/approvals', authMiddleware, getApprovals);

// Process 2.5: Forward approval results to the reconciliation queue
router.post(
  '/:groupId/approval-results',
  authMiddleware,
  roleMiddleware(['professor', 'admin']),
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
  roleMiddleware(['coordinator', 'professor', 'admin']),
  transitionStatus
);

// POST /api/v1/groups/:groupId/deliverables — Process 4.5: Submit deliverable
router.post(
  '/:groupId/deliverables',
  authMiddleware,
  roleMiddleware(['student', 'leader']),
  checkScheduleWindow(OPERATION_TYPES.DELIVERABLE_SUBMISSION),
  submitDeliverableHandler
);

/**
 * DELETE /api/v1/groups/:groupId/advisor — Process 3.5: Release current advisor
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
 */
router.post(
  '/:groupId/advisor/transfer',
  authMiddleware,
  roleMiddleware(['coordinator']), 
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_TRANSFER),
  transferAdvisor
);

module.exports = router;
