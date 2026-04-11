'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');
const { listProfessorPendingRequests } = require('../controllers/advisorRequests');
const { submitAdvisorRequest, processAdvisorRequest } = require('../controllers/advisorAssociation');

// GET /api/v1/advisor-requests/pending — List pending requests (Professor only)
router.get(
  '/pending',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

// POST /api/v1/advisor-requests — Submit a request (Student leader only)
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_ASSOCIATION),
  submitAdvisorRequest
);

// PATCH /api/v1/advisor-requests/:requestId — Approve/Reject (Professor only)
router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_DECISION),
  processAdvisorRequest
);

module.exports = router;
