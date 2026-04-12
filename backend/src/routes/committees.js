const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const {
  createCommittee,
  validateCommitteeHandler,
  publishCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
} = require('../controllers/committees');

/**
 * POST /committees
 * Create Committee (Process 4.1)
 * 
 * Coordinator creates a new committee draft.
 * Requires: coordinator role, committeeName (unique), optional description
 * 
 * Response (201):
 * {
 *   committeeId, committeeName, description, advisorIds[], juryIds[],
 *   status: "draft", createdAt, updatedAt
 * }
 */
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator']),
  createCommittee
);

/**
 * POST /committees/{committeeId}/advisors
 * Assign Advisors to Committee (Process 4.2)
 * 
 * Coordinator assigns advisors to a committee draft.
 * Requires: coordinator role, advisorIds[]
 * 
 * Response (200):
 * Updated Committee object with populated advisorIds[]
 */
router.post(
  '/:committeeId/advisors',
  authMiddleware,
  roleMiddleware(['coordinator']),
  assignAdvisorsHandler
);

/**
 * POST /committees/{committeeId}/jury
 * Add Jury Members to Committee (Process 4.3)
 * 
 * Coordinator assigns jury members to a committee draft.
 * Requires: coordinator role, juryIds[]
 * 
 * Response (200):
 * Updated Committee object with populated juryIds[]
 */
router.post(
  '/:committeeId/jury',
  authMiddleware,
  roleMiddleware(['coordinator']),
  assignJuryHandler
);

/**
 * POST /committees/{committeeId}/validate
 * Validate Committee Setup (Process 4.4)
 * 
 * Validates whether the committee contains required advisor and jury assignments.
 * Sets status to "validated" if valid.
 * Requires: coordinator role
 * 
 * Response (200):
 * {
 *   committeeId, valid: boolean, missingRequirements[], checkedAt
 * }
 */
router.post(
  '/:committeeId/validate',
  authMiddleware,
  roleMiddleware(['coordinator']),
  validateCommitteeHandler
);

/**
 * POST /committees/{committeeId}/publish
 * Publish Committee (Process 4.5)
 * 
 * Publishes the validated committee configuration, stores final committee data,
 * and triggers committee notifications (Flow f06: 4.5 → D3).
 * Requires: coordinator role, committee must be in "validated" status
 * 
 * Response (200):
 * {
 *   committeeId, status: "published", publishedAt, notificationTriggered
 * }
 * 
 * Error responses:
 * - 400: Committee is incomplete or invalid / not in validated status
 * - 403: Not a coordinator
 * - 404: Committee not found
 * - 409: Committee is already published
 */
router.post(
  '/:committeeId/publish',
  authMiddleware,
  roleMiddleware(['coordinator']),
  publishCommitteeHandler
);

module.exports = router;
