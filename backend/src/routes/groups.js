'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware, serviceOrBearerAuth } = require('../middleware/auth');
const { checkJiraSyncRateLimit } = require('../middleware/jiraSyncRateLimit');
const { checkScheduleWindow, checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');

// Controllers
const {
  forwardApprovalResults,
  createGroup,
  getGroup,
  getAllGroups,
  getSprintContributionSummary,
  getGroupCommitteeStatus,
  createMemberRequest,
  decideMemberRequest,
  coordinatorOverride,
  getGroupSprints,
} = require('../controllers/groups');

const { 
  addMember, 
  getMembers, 
  dispatchNotification, 
  membershipDecision, 
  getMyPendingInvitation, 
  getApprovals 
} = require('../controllers/groupMembers');

const { configureGithub, getGithub, configureJira, getJira, mockConfigureJira } = require('../controllers/groupIntegrations');
const { transitionStatus, getStatus } = require('../controllers/groupStatusTransition');
const { triggerGitHubSync, getSyncJobStatus, getLatestSyncJob, getSyncJobLogs } = require('../controllers/githubSync');
const { triggerJiraSync, getJiraSyncStatus, getJiraSyncLogs, mockJiraSync } = require('../controllers/jiraSync');
const {
  reconcileD4toD6,
} = require('../controllers/sprintTracking');
const {
  recalculateContributions,
  requireCoordinatorRole,
} = require('../controllers/contributionRatios');
const { coordinatorAdminOrGroupMember } = require('../middleware/groupIntegrationReadAccess');

// Integrated Controllers from both branches
const { submitDeliverableHandler } = require('../controllers/deliverables'); // From main
const { releaseAdvisor, transferAdvisor, advisorSanitization } = require('../controllers/advisorAssociation'); // From main
const { bootstrapSprint } = require('../controllers/coordinatorSprintBootstrap');

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

// GET /api/v1/groups — Coordinator/admin dashboard list
router.get('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), getAllGroups);

// GET /api/v1/groups/:groupId — Detailed group record
router.get('/:groupId', authMiddleware, getGroup);

/**
 * GET /api/v1/groups/:groupId/committee-status — Committee status lookup (From your branch)
 */
router.get('/:groupId/committee-status', authMiddleware, getGroupCommitteeStatus);

// GET /api/v1/groups/:groupId/sprints — list available sprints for deliverable submission
router.get('/:groupId/sprints', authMiddleware, getGroupSprints);

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

router.post('/:groupId/github', authMiddleware, roleMiddleware(['coordinator', 'admin']), configureGithub);
router.get('/:groupId/github', authMiddleware, coordinatorAdminOrGroupMember, getGithub);
router.post('/:groupId/jira', authMiddleware, roleMiddleware(['coordinator', 'admin']), configureJira);
router.get('/:groupId/jira', authMiddleware, coordinatorAdminOrGroupMember, getJira);
router.post(
  '/:groupId/sprints/:sprintId/jira-sync',
  serviceOrBearerAuth,
  roleMiddleware(['coordinator', 'admin']),
  checkJiraSyncRateLimit,
  triggerJiraSync
);
// Dev-only: mock Jira endpoints — bypass real API calls
if (process.env.NODE_ENV !== 'production') {
  router.post('/:groupId/jira/mock', authMiddleware, mockConfigureJira);
  router.post('/:groupId/sprints/:sprintId/jira-sync/mock', authMiddleware, mockJiraSync);
}

// POST /api/v1/groups/:groupId/sprints — Coordinator bootstrap empty sprint
// (used when no Jira/GitHub sync exists yet, so the sprint dropdown stays
// empty and downstream flows like deliverable assignment break)
router.post(
  '/:groupId/sprints',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  bootstrapSprint
);

// ============================================================================
// PROCESS 7.2 — GitHub PR Sync (async validation bridge)
//
// POST   /:groupId/sprints/:sprintId/github-sync          — trigger sync job
// GET    /:groupId/sprints/:sprintId/github-sync          — latest job status
// GET    /:groupId/sprints/:sprintId/github-sync/:jobId   — specific job status
// ============================================================================

router.post(
  '/:groupId/sprints/:sprintId/github-sync',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  triggerGitHubSync
);

router.get(
  '/:groupId/sprints/:sprintId/github-sync',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getLatestSyncJob
);

router.get(
  '/:groupId/sprints/:sprintId/github-sync/:jobId',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getSyncJobStatus
);

router.get(
  '/:groupId/sprints/:sprintId/github-sync/:jobId/logs',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getSyncJobLogs
);

// ============================================================================
// PROCESS 7.1 — JIRA Sprint Sync (async ingestion bridge)
// ============================================================================
router.get(
  '/:groupId/sprints/:sprintId/jira-sync',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getJiraSyncStatus
);

router.get(
  '/:groupId/sprints/:sprintId/jira-sync/:jobId',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getJiraSyncStatus
);

router.get(
  '/:groupId/sprints/:sprintId/jira-sync/:jobId/logs',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getJiraSyncLogs
);

// ============================================================================
// PROCESS 7.3/7.4/7.5 — Contribution recalculation (sync response)
// ============================================================================
router.post(
  '/:groupId/sprints/:sprintId/contributions/recalculate',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  requireCoordinatorRole,
  recalculateContributions
);

router.post(
  '/:groupId/sprints/:sprintId/reconcile-deliverables',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  reconcileD4toD6
);

router.patch(
  '/:groupId/override',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
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
  roleMiddleware(['student', 'coordinator', 'admin']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_RELEASE),
  releaseAdvisor
);

/**
 * POST /api/v1/groups/:groupId/advisor/transfer — Process 3.6: Coordinator transfer
 */
router.post(
  '/:groupId/advisor/transfer',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_TRANSFER),
  transferAdvisor
);

module.exports = router;
