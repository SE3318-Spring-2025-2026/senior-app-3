const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware, flexibleSystemOrRoleAuth } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');
const { forwardApprovalResults, createGroup, getGroup, getAllGroups, createMemberRequest, decideMemberRequest, coordinatorOverride } = require('../controllers/groups');
const { addMember, getMembers, dispatchNotification, membershipDecision, getMyPendingInvitation, getApprovals } = require('../controllers/groupMembers');
const { configureGithub, getGithub, configureJira, getJira } = require('../controllers/groupIntegrations');
const { transitionStatus, getStatus } = require('../controllers/groupStatusTransition');
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

/**
 * ========================================
 * POST /api/v1/groups/advisor-sanitization
 * Issue #67: Disband Unassigned Groups After Advisor Association Deadline
 * ========================================
 * 
 * Process 3.7 of Level 2.3 (Advisor Association) Flow
 * 
 * PURPOSE:
 * ────────
 * After the coordinator-defined advisor association deadline passes,
 * automatically disband all groups that failed to secure an advisor.
 * Clears their advisor-related fields and notifies group members.
 * 
 * REQUEST:
 * ────────
 * METHOD:  POST
 * BODY:    { groupIds?: string[] }  // Optional: specific groups to disband
 * 
 * RESPONSE (200 OK):
 * ──────────────────
 * {
 *   "disbandedGroups": ["grp_123", "grp_456"],
 *   "checkedAt": "2026-04-11T15:30:00Z",
 *   "message": "Sanitization complete: 2 group(s) disbanded, 0 failed",
 *   "details": {
 *     "total_checked": 5,
 *     "successfully_disbanded": 2,
 *     "failed": 0,
 *     "errors": []
 *   }
 * }
 * 
 * MIDDLEWARE STACK (EXECUTION ORDER):
 * ───────────────────────────────────
 * 1. flexibleSystemOrRoleAuth — M2M first (X-Service-Auth), else coordinator/admin JWT
 * 2. advisorSanitization — Main controller logic
 * 
 * AUTHORIZATION:
 * ──────────────
 * Allowed callers:
 * ✅ Coordinator user (JWT + role:coordinator)
 * ✅ Admin user (JWT + role:admin)
 * ✅ System service account (X-Service-Auth header with SYSTEM_SERVICE_TOKEN)
 * ✅ Cron job / Scheduler (if configured with service token)
 * 
 * Denied:
 * ❌ Unauthenticated requests (401)
 * ❌ Invalid JWT token (401)
 * ❌ User with other role (403)
 * ❌ Invalid service token (403)
 * 
 * ISSUE #67 FIXES APPLIED IN THIS ENDPOINT:
 * ────────────────────────────────────────
 * Fix #1: SECURITY - Deadline fetched from ScheduleWindow DB (not request body)
 *         Prevents coordinator from manipulating deadline to trigger early
 * 
 * Fix #2: PERFORMANCE - Response returns immediately (200 OK)
 *         Notifications dispatched asynchronously in background
 *         Prevents event loop blocking and response timeouts
 * 
 * Fix #3: DATABASE - Uses bulkWrite() for single DB round-trip
 *         Changes status from 'inactive' to 'disbanded' (spec compliant)
 *         Eliminates N+1 database write pattern
 * 
 * Fix #4: AUTHORIZATION - flexibleSystemOrRoleAuth (service token without JWT, or coordinator/admin JWT)
 *         Enables schedulers/cron jobs to trigger sanitization
 * 
 * Fix #5: INPUT VALIDATION - Validates groupIds parameter
 *         Must be array of non-empty strings, max 500 items
 * 
 * ERROR RESPONSES:
 * ────────────────
 * 400 Bad Request - Invalid input (malformed groupIds)
 * 401 Unauthorized - No/invalid authentication credentials
 * 403 Forbidden - User lacks authorization (not coordinator/admin/system)
 * 409 Conflict - Deadline not reached yet
 * 500 Internal Server Error - Unexpected server error
 * 
 * PERFORMANCE CHARACTERISTICS:
 * ────────────────────────────
 * Response Time:
 * - Small run (< 10 groups): ~50-100ms (quick database operations)
 * - Medium run (10-50 groups): ~100-200ms (database efficiency from bulkWrite)
 * - Large run (100+ groups): ~200-500ms (disk I/O) + background notifications
 * 
 * Background Tasks (non-blocking):
 * - Notification dispatch: 1-5 seconds per batch (runs in background)
 * - Error logging: ~100ms per failed group
 * 
 * EXAMPLE CURL COMMANDS:
 * ──────────────────────
 * // User-based authorization (coordinator with JWT)
 * curl -X POST http://localhost:5000/api/v1/groups/advisor-sanitization \
 *   -H "Authorization: Bearer $JWT_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{"groupIds": ["grp_001", "grp_002"]}'
 * 
 * // System-based authorization (scheduled job with service token)
 * curl -X POST http://localhost:5000/api/v1/groups/advisor-sanitization \
 *   -H "X-Service-Auth: $SYSTEM_SERVICE_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{}'
 */
// Issue #67: Service token (X-Service-Auth) does not require Bearer JWT
router.post('/advisor-sanitization', flexibleSystemOrRoleAuth, advisorSanitization);

module.exports = router;
