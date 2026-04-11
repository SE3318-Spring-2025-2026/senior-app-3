const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow, checkAdvisorAssociationSchedule } = require('../middleware/scheduleWindow');
const { forwardApprovalResults, createGroup, getGroup, getAllGroups, createMemberRequest, decideMemberRequest, coordinatorOverride } = require('../controllers/groups');
const { addMember, getMembers, dispatchNotification, membershipDecision, getMyPendingInvitation, getApprovals } = require('../controllers/groupMembers');
const { configureGithub, getGithub, configureJira, getJira } = require('../controllers/groupIntegrations');
const { transitionStatus, getStatus } = require('../controllers/groupStatusTransition');
const { releaseAdvisorHandler, transferAdvisorHandler } = require('../controllers/advisorDecision');
const { advisorSanitization } = require('../controllers/sanitizationController');

// POST /api/v1/groups — Process 2.1 + 2.2: create, validate, persist, forward to 2.5
router.post('/', authMiddleware, roleMiddleware(['student']), createGroup);

// GET /api/v1/groups/pending-invitation — return current user's pending invitation with group info
router.get('/pending-invitation', authMiddleware, getMyPendingInvitation);

// GET /api/v1/groups — List all groups (coordinator only) for group management dashboard
router.get('/', authMiddleware, roleMiddleware(['coordinator']), getAllGroups);

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

// ============================================================================
// ADVISOR ASSOCIATION WORKFLOW (Process 3.0 — Level 2.3)
// POST/PATCH /advisor-requests — mounted at /api/v1/advisor-requests (see advisorRequests.js)
// ============================================================================

// DELETE /api/v1/groups/:groupId/advisor — Process 3.5: Release current advisor
// Schedule: Subject to advisor_association window enforcement (422 if outside)
router.delete(
  '/:groupId/advisor',
  authMiddleware,
  checkAdvisorAssociationSchedule(),
  releaseAdvisorHandler
);

// POST /api/v1/groups/:groupId/advisor/transfer — Process 3.6: Coordinator transfer
// Schedule: Subject to advisor_association window enforcement (422 if outside)
/**
 * =====================================================================
 * FIX #3b: REMOVE 'ADMIN' FROM COORDINATOR-ONLY ROUTE (ISSUE #70 - HIGH)
 * =====================================================================
 * PROBLEM: roleMiddleware(['coordinator', 'admin']) violates DFD access control
 * constraints. Process 3.6 (Advisor transfer) is explicitly defined in the DFD
 * as a COORDINATOR-ONLY operation. Coordinators are group management experts
 * responsible for reassigning advisors due to logistical needs; system
 * administrators have no domain expertise in group coordination.
 * 
 * WHAT CHANGED: Removed 'admin' from the roleMiddleware array
 * OLD: roleMiddleware(['coordinator', 'admin'])
 * NEW: roleMiddleware(['coordinator'])
 * 
 * WHY: Enforces principle of least privilege and maintains DFD separation
 * of concerns. 'admin' role should only be used for system-level operations
 * (user management, audit logs, etc.), not group coordination decisions.
 * 
 * IMPACT: Admin users can no longer transfer advisors. Coordinators must
 * transfer via their domain role. This is correct behavior per DFD.
 * =====================================================================
 */
router.post(
  '/:groupId/advisor/transfer',
  authMiddleware,
  roleMiddleware(['coordinator']),
  checkAdvisorAssociationSchedule(),
  transferAdvisorHandler
);

// POST /api/v1/groups/advisor-sanitization — Process 3.7: Disband unassigned groups
// Note: NOT subject to schedule middleware — uses deadline-based gating instead
router.post(
  '/advisor-sanitization',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  advisorSanitization
);

module.exports = router;
