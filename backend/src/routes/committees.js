const express = require('express');
const router = express.Router();
const {
  createCommittee,
  assignAdvisorsHandler,
  assignJuryHandler,
  validateCommitteeHandler,
  publishCommittee,
} = require('../controllers/committees');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

/**
 * Process 4.1: Create Committee Draft
 * POST /api/v1/committees
 */
router.post('/', authMiddleware, roleMiddleware(['coordinator']), createCommittee);

/**
 * Process 4.2: Assign Advisors
 * POST /api/v1/committees/:committeeId/advisors
 */
router.post('/:committeeId/advisors', authMiddleware, roleMiddleware(['coordinator']), assignAdvisorsHandler);

/**
 * Process 4.3: Assign Jury Members
 * POST /api/v1/committees/:committeeId/jury
 */
router.post('/:committeeId/jury', authMiddleware, roleMiddleware(['coordinator']), assignJuryHandler);

/**
 * Process 4.4: Validate Committee
 * POST /api/v1/committees/:committeeId/validate
 */
router.post('/:committeeId/validate', authMiddleware, roleMiddleware(['coordinator']), validateCommitteeHandler);

/**
 * Process 4.5: Publish Committee (transaction + notifications — committeePublishService)
 * POST /api/v1/committees/:committeeId/publish
 */
router.post('/:committeeId/publish', authMiddleware, roleMiddleware(['coordinator']), publishCommittee);

module.exports = router;
