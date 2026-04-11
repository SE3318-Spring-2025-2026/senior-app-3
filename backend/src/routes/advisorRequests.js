const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');

// Controllers
const advisorRequestController = require('../controllers/advisorRequestController');
const { listProfessorPendingRequests, decideAdvisorRequest } = require('../controllers/advisorRequests');

/**
 * POST /api/v1/advisor-requests
 * Submit a new advisor request (Process 3.1)
 */
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkScheduleWindow('advisor_association'),
  advisorRequestController.createRequest
);

/**
 * GET /api/v1/advisor-requests/mine
 * List professor's pending requests
 */
router.get(
  '/mine',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

/**
 * PATCH /api/v1/advisor-requests/:requestId
 * Professor decides on an advisor request
 */
router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkScheduleWindow('advisor_association', { statusCode: 422 }),
  decideAdvisorRequest
);

module.exports = router;