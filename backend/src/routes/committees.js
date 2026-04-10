const express = require('express');
const { publishCommittee, createCommittee } = require('../controllers/committees');
const { roleMiddleware } = require('../middleware/roleMiddleware');

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
router.post('/', roleMiddleware(['coordinator']), createCommittee);

/**
 * POST /committees/{committeeId}/publish
 * Publish Committee (Process 4.5)
 * 
 * Publishes the validated committee configuration, stores the final committee data,
 * updates related assignments, and triggers committee notifications.
 * 
 * DFD flow f09: 4.5 → Notification Service
 * 
 * Requires: coordinator role
 * Prerequisite: committee must be in "validated" status
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
 * - 403: Not a coordinator
 * - 404: Committee not found
 * - 409: Committee is already published
 */
router.post('/:committeeId/publish', roleMiddleware(['coordinator']), publishCommittee);

module.exports = router;
