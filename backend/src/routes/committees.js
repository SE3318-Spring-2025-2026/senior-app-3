const express = require('express');
const { publishCommittee, createCommittee } = require('../controllers/committees');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /committees
 * Create Committee (Process 4.1)
 * 
 * Coordinator creates a new committee draft.
 * Requires: coordinator role
 * 
 * Request body:
 * {
 *   committeeName: string (required, min 3, max 100)
 *   description: string (optional)
 *   coordinatorId: string (required)
 * }
 * 
 * Response (201):
 * {
 *   committeeId: string
 *   committeeName: string
 *   description: string
 *   status: "draft"
 *   advisorIds: []
 *   juryIds: []
 *   createdAt: ISO date
 * }
 */
router.post('/', authMiddleware, roleMiddleware(['coordinator']), createCommittee);

/**
 * POST /committees/{committeeId}/publish
 * Publish Committee (Process 4.5)
 * 
 * Publishes the validated committee configuration, stores the final committee data,
 * updates related assignments (D2 Groups), and triggers committee notifications.
 * 
 * DFD flows:
 * - f06: 4.5 → D3 (Committee) - Update committee status
 * - f07: 4.5 → D2 (Groups) - Link groups to committee
 * - f09: 4.5 → Notification Service - Dispatch notifications
 * 
 * Requires: authMiddleware + coordinator role
 * Prerequisite: committee must be in "validated" status
 * 
 * Request body:
 * {
 *   assignedGroupIds: string[] (optional, group IDs to link to committee)
 * }
 * 
 * Response (200):
 * {
 *   committeeId: string
 *   status: "published"
 *   publishedAt: ISO date
 *   notificationTriggered: boolean
 * }
 * 
 * Error responses:
 * - 400: Committee is incomplete or invalid / not in validated status
 * - 403: Not authenticated or not a coordinator
 * - 404: Committee not found
 * - 409: Committee is already published
 * 
 * ARCHITECTURAL NOTE (Issue #81 FIX #1):
 * 
 * DEFICIENCY (from PR review):
 * "the route uses roleMiddleware(['coordinator']) but is missing the standard
 *  authMiddleware that precedes it. Without req.user being set by authMiddleware,
 *  the role check will fail with a 401."
 * 
 * SOLUTION:
 * Added authMiddleware as the FIRST middleware in the chain, BEFORE roleMiddleware.
 * This ensures:
 * 1. authMiddleware runs first and populates req.user from JWT token
 * 2. roleMiddleware runs second and checks req.user.role === 'coordinator'
 * 3. Controller receives authenticated and authorized request
 * 
 * Middleware chain: authMiddleware → roleMiddleware → publishCommittee controller
 * 
 * Without authMiddleware:
 * ❌ req.user is undefined
 * ❌ roleMiddleware cannot access req.user.role
 * ❌ Authorization bypass (any unauthenticated user passes through)
 * 
 * With authMiddleware:
 * ✅ req.user is populated with userId, role, email
 * ✅ roleMiddleware can verify role === 'coordinator'
 * ✅ Proper authorization enforced (401 for missing token, 403 for wrong role)
 */
router.post(
  '/:committeeId/publish',
  authMiddleware,
  roleMiddleware(['coordinator']),
  publishCommittee
);

module.exports = router;
