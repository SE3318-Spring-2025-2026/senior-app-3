const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');
const { createAdvisorRequest } = require('../controllers/groups');
const { listProfessorPendingRequests, decideAdvisorRequest } = require('../controllers/advisorRequests');

/**
 * POST /api/v1/advisor-requests — Process 3.2 (Issue #61)
 */
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkScheduleWindow('advisor_association'),
  createAdvisorRequest
);

router.get(
  '/mine',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkScheduleWindow('advisor_association', { statusCode: 422 }),
  decideAdvisorRequest
);

module.exports = router;