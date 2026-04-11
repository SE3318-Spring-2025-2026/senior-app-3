const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { checkAdvisorAssociationSchedule } = require('../middleware/scheduleWindow');
const { createAdvisorRequest } = require('../controllers/groups');
const { advisorApproveRequest } = require('../controllers/advisorDecision');

// POST /api/v1/advisor-requests — Process 3.1 + 3.2: Submit & validate advisee request
// Schedule: Subject to advisor_association window enforcement (422 if outside)
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['student']),
  checkAdvisorAssociationSchedule(),
  createAdvisorRequest
);

// PATCH /api/v1/advisor-requests/:requestId — Process 3.4: Advisor approve/reject decision
// Schedule: Subject to advisor_association window enforcement (422 if outside)
router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor']),
  checkAdvisorAssociationSchedule(),
  advisorApproveRequest
);

module.exports = router;
