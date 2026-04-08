const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');
const { listProfessorPendingRequests, decideAdvisorRequest } = require('../controllers/advisorRequests');

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
