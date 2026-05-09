const express = require('express');
const router = express.Router();
const {
  createCommittee,
  listCommittees,
  getCommitteeById,
  assignAdvisorsHandler,
  assignJuryHandler,
  validateCommitteeHandler,
  publishCommittee,
  getMyJuryCommittees,
} = require('../controllers/committees');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

/**
 * Process 4.1: Create Committee Draft
 * POST /api/v1/committees
 */
router.post('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), createCommittee);
router.get('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), listCommittees);
router.get('/my-jury', authMiddleware, roleMiddleware(['professor', 'committee_member', 'admin']), getMyJuryCommittees);
router.get('/:committeeId', authMiddleware, roleMiddleware(['coordinator', 'admin']), getCommitteeById);

/**
 * Process 4.2: Assign Advisors
 * POST /api/v1/committees/:committeeId/advisors
 */
router.post('/:committeeId/advisors', authMiddleware, roleMiddleware(['coordinator', 'admin']), assignAdvisorsHandler);

/**
 * Process 4.3: Assign Jury Members
 * POST /api/v1/committees/:committeeId/jury
 */
router.post('/:committeeId/jury', authMiddleware, roleMiddleware(['coordinator', 'admin']), assignJuryHandler);

/**
 * Process 4.4: Validate Committee
 * POST /api/v1/committees/:committeeId/validate
 */
router.post('/:committeeId/validate', authMiddleware, roleMiddleware(['coordinator', 'admin']), validateCommitteeHandler);

/**
 * Process 4.5: Publish Committee (transaction + notifications — committeePublishService)
 * POST /api/v1/committees/:committeeId/publish
 */
router.post('/:committeeId/publish', authMiddleware, roleMiddleware(['coordinator', 'admin']), publishCommittee);

module.exports = router;
