'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');

// Controllers
const { listProfessorPendingRequests } = require('../controllers/advisorRequests');
const { submitAdvisorRequest, processAdvisorRequest } = require('../controllers/advisorAssociation');

/**
 * GET /api/v1/advisor-requests/pending
 * Process 3.4: List professor's pending advisee requests
 */
router.get(
  '/pending',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

/**
 * POST /api/v1/advisor-requests
 * Process 3.1 + 3.2: Student leader submits an advisee request
 * Schedule: Subject to advisor_association window enforcement (422 if outside)
 */
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_ASSOCIATION),
  submitAdvisorRequest
);

/**
 * PATCH /api/v1/advisor-requests/:requestId
 * Process 3.4 + 3.5: Professor approves or rejects an advisee request
 * Schedule: Subject to advisor_decision window enforcement (422 if outside)
 */
router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_DECISION),
  processAdvisorRequest
);

module.exports = router;