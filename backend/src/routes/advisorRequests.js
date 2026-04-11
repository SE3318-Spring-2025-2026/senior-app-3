const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');
const { ADVISOR_ASSOCIATION } = require('../utils/operationTypes');
const {
  listProfessorPendingRequests,
  createAdvisorRequest,
  decideAdvisorRequest
} = require('../controllers/advisorRequests');

// GET /api/v1/advisor-requests/pending - List pending requests (Professor only)
router.get(
  '/pending',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

// POST /api/v1/advisor-requests - Submit a request (Student leader only)
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkScheduleWindow(ADVISOR_ASSOCIATION),
  createAdvisorRequest
);

// PATCH /api/v1/advisor-requests/:requestId - Approve/Reject (Professor only)
router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  decideAdvisorRequest
);

module.exports = router;
