const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { committeeLimiter } = require('../middleware/committeeLimiter');
const { validateCommitteeSetup } = require('../services/committeeValidationService');
const {
  createCommittee,
  listCommittees,
  getCommittee,
  assignCommitteeAdvisors,
  addJuryMembers,
} = require('../controllers/committeeController');

// Using placeholder function for publishCommittee until Issue #81 is implemented
const publishCommittee = async (req, res) => {
  res.status(501).json({
    code: 'NOT_IMPLEMENTED',
    message: 'Publish endpoint will be implemented in Issue #81',
  });
};

/**
 * GET /api/v1/committees
 */
router.get(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  listCommittees
);

/**
 * POST /api/v1/committees
 */
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator']),
  committeeLimiter,
  createCommittee
);

/**
 * GET /api/v1/committees/:committeeId
 */
router.get(
  '/:committeeId',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getCommittee
);

/**
 * POST /api/v1/committees/:committeeId/advisors
 */
router.post(
  '/:committeeId/advisors',
  authMiddleware,
  roleMiddleware(['coordinator']),
  assignCommitteeAdvisors
);

/**
 * POST /api/v1/committees/:committeeId/jury
 */
router.post(
  '/:committeeId/jury',
  authMiddleware,
  roleMiddleware(['coordinator']),
  addJuryMembers
);

/**
 * POST /api/v1/committees/:committeeId/validate
 */
router.post(
  '/:committeeId/validate',
  authMiddleware,
  roleMiddleware(['coordinator']),
  async (req, res) => {
    try {
      const { committeeId } = req.params;
      const coordinatorId = req.user.userId;

      // Use committeeValidationService for validation logic
      const validationResult = await validateCommitteeSetup(committeeId, coordinatorId);

      res.status(200).json({
        committeeId: validationResult.committeeId,
        valid: validationResult.valid,
        missingRequirements: validationResult.missingRequirements,
        checkedAt: validationResult.checkedAt,
        status: validationResult.status,
      });
    } catch (err) {
      if (err.status && err.code) {
        // Known error from validation service
        return res.status(err.status).json({
          code: err.code,
          message: err.message,
        });
      }

      console.error('[POST /committees/:committeeId/validate]', err);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Failed to validate committee setup',
      });
    }
  }
);

/**
 * POST /api/v1/committees/:committeeId/publish
 */
router.post(
  '/:committeeId/publish',
  authMiddleware,
  roleMiddleware(['coordinator']),
  publishCommittee
);

module.exports = router;
