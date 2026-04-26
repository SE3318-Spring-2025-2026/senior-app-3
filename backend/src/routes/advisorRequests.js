'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkAdvisorOperationWindow } = require('../middleware/scheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');
const {
  listProfessorAdvisorRequests,
  listProfessorPendingRequests,
  listCoordinatorPendingAdvisorRequests,
  submitAdvisorRequest,
  processAdvisorRequest,
  cancelAdvisorRequest,
} = require('../controllers/advisorAssociation');

/** Professors still respect the advisor decision window; coordinator/admin may decide anytime. */
const advisorDecisionScheduleGuard = (req, res, next) => {
  const role = req.user?.role;
  if (role === 'coordinator' || role === 'admin') {
    return next();
  }
  return checkAdvisorOperationWindow(OPERATION_TYPES.ADVISOR_DECISION)(req, res, next);
};

router.get(
  '/coordinator/pending',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  listCoordinatorPendingAdvisorRequests
);

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
  roleMiddleware(['professor', 'coordinator', 'admin']),
  advisorDecisionScheduleGuard,
  processAdvisorRequest
);

// Cancel a pending advisor request. Students (team leader) can cancel
// their own; coordinator/admin can cancel any. Intentionally NOT guarded
// by the advisor schedule window – cancelling shouldn't be blocked when
// the association window is still in the future.
router.delete(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['student', 'coordinator', 'admin']),
  cancelAdvisorRequest
);

module.exports = router;
