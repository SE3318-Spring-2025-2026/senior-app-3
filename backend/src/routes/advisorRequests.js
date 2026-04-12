'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');

// Unified Controller imports 
// (Ensure your exports in advisorAssociation and advisorRequests are consistent)
const { 
  submitAdvisorRequest, 
  processAdvisorRequest, 
  listProfessorPendingRequests 
} = require('../controllers/advisorRequestController');

/**
 * GET /api/v1/advisor-requests/pending
 * Process 3.4: List professor's pending advisee requests.
 * Used by the Professor Dashboard.
 */
router.get(
  '/pending',
  authMiddleware,
  roleMiddleware(['professor']),
  listProfessorPendingRequests
);

/**
 * POST /api/v1/advisor-requests
 * Process 3.1 + 3.2: Student leader submits an advisee request.
 * Guarded by: Authentication, Student Role, and the Global Schedule Window.
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
 * Process 3.4 + 3.5: Professor approves or rejects an advisee request.
 * Guarded by: Professor Role and the Decision Window.
 */
router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_DECISION || 'advisor_decision'),
  processAdvisorRequest
);

module.exports = router;