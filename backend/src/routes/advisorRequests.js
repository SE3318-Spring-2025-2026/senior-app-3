const express = require('express');
const router = express.Router();
const advisorRequestController = require('../controllers/advisorRequestController');
const { authMiddleware } = require('../middleware/auth');
const { checkScheduleWindow } = require('../middleware/scheduleWindow');

/**
 * POST /api/v1/advisor-requests
 * Submit a new advisor request (Process 3.1)
 */
router.post(
  '/',
  authMiddleware,
  checkScheduleWindow('advisor_association'),
  advisorRequestController.createRequest
);

module.exports = router;
