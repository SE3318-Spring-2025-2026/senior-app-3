const express = require('express');
const router = express.Router();
const {
  createCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
  validateCommitteeHandler,
  publishCommitteeHandler,
  getCommitteeHandler,
  listCommitteesHandler,
} = require('../controllers/committees');
const { authorize } = require('../middleware/authorization');

/**
 * Process 4.1: Create Committee Draft
 * POST /api/v1/committees
 */
router.post('/', authorize(['coordinator']), createCommitteeHandler);
router.get('/', authorize(['coordinator', 'admin']), listCommitteesHandler);

/**
 * Process 4.2: Assign Advisors
 * POST /api/v1/committees/:committeeId/advisors
 */
router.post('/:committeeId/advisors', authorize(['coordinator']), assignAdvisorsHandler);

/**
 * Process 4.3: Assign Jury Members
 * POST /api/v1/committees/:committeeId/jury
 */
router.post('/:committeeId/jury', authorize(['coordinator']), assignJuryHandler);

/**
 * Process 4.4: Validate Committee
 * POST /api/v1/committees/:committeeId/validate
 */
router.post('/:committeeId/validate', authorize(['coordinator']), validateCommitteeHandler);

/**
 * Process 4.5: Publish Committee (transaction + notifications — committeePublishService)
 * POST /api/v1/committees/:committeeId/publish
 */
router.post('/:committeeId/publish', authorize(['coordinator']), publishCommitteeHandler);

/**
 * Get Committee
 * GET /api/v1/committees/:committeeId
 */
router.get(
  '/:committeeId',
  authorize(['coordinator', 'advisor', 'jury', 'student']),
  getCommitteeHandler
);

module.exports = router;
