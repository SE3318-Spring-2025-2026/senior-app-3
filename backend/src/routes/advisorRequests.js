'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');
const {
  listProfessorAdvisorRequests,
  listProfessorPendingRequests,
  submitAdvisorRequest,
  processAdvisorRequest,
} = require('../controllers/advisorAssociation');

router.get(
  '/mine',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorAdvisorRequests
);

router.get(
  '/pending',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_ASSOCIATION),
  submitAdvisorRequest
);

router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_DECISION),
  processAdvisorRequest
);

module.exports = router;
