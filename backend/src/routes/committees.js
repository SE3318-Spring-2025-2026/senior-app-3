const express = require('express');
const router = express.Router();
const {
  createCommitteeHandler,
  validateCommitteeHandler,
  publishCommitteeHandler,
  getCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
} = require('../controllers/committees');
const { authorize } = require('../middleware/authorization');

/**
 * Process 4.1: Create Committee Draft
 * POST /api/v1/committees
 */
router.post('/', authorize(['coordinator']), createCommitteeHandler);

/**
 * Process 4.3: Assign Advisors
 * POST /api/v1/committees/:committeeId/advisors
 */
router.post('/:committeeId/advisors', authorize(['coordinator']), assignAdvisorsHandler);

/**
 * Process 4.4: Assign Jury Members
 * POST /api/v1/committees/:committeeId/jury
 */
router.post('/:committeeId/jury', authorize(['coordinator']), assignJuryHandler);

/**
 * Process 4.2: Validate Committee
 * POST /api/v1/committees/:committeeId/validate
 */
router.post('/:committeeId/validate', authorize(['coordinator']), validateCommitteeHandler);

/**
 * Process 4.5: Publish Committee (triggers atomic D6 updates for Issue #86)
 * POST /api/v1/committees/:committeeId/publish
 */
router.post('/:committeeId/publish', authorize(['coordinator']), publishCommitteeHandler);

/**
 * Get Committee
 * GET /api/v1/committees/:committeeId
 */
router.get('/:committeeId', authorize(['coordinator', 'advisor', 'jury', 'student']), getCommitteeHandler);

module.exports = router;
