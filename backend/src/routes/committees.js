const express = require('express');
const router = express.Router();
const {
  createCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
  validateCommitteeHandler,
  publishCommitteeHandler,
  getCommitteeHandler,
} = require('../controllers/committees');
const { authorize } = require('../middleware/authorization');

/**
 * Process 4.1: Create Committee Draft
 * POST /api/v1/committees
 */
router.post('/', authorize(['coordinator']), createCommitteeHandler);

/**
 * Process 4.2: Assign Advisors
 * POST /api/v1/committees/:committeeId/advisors
 */
router.post('/:committeeId/advisors', authorize(['coordinator']), assignAdvisorsHandler);

/**
 * Process 4.3: Assign Jury Members
 * POST /api/v1/committees/:committeeId/jury
 */
router.post('/:committeeId/jury', authorize(['coordinator']), assignJuryHandler);

/**
 * Process 4.4: Validate Committee
 * POST /api/v1/committees/:committeeId/validate
 */
router.post('/:committeeId/validate', authorize(['coordinator']), validateCommitteeHandler);

/**
 * Process 4.5: Publish Committee (triggers notification - Issue #87)
 * 
 * Endpoint: POST /api/v1/committees/:committeeId/publish
 * Authorization: Coordinator only
 * 
 * Workflow:
 * 1. Coordinator calls this endpoint with committeeId
 * 2. Authorization middleware checks role (403 if not coordinator)
 * 3. publishCommitteeHandler() executes:
 *    a) Validate committee exists and is validated
 *    b) Update D3: status → published, publishedAt timestamp
 *    c) Log audit event
 *    d) **CRITICAL**: Call sendCommitteeNotification() (Flow f09)
 *       - Aggregates recipients (advisors + jury + group members)
 *       - Dispatches to Notification Service
 *       - Retry logic: 3 attempts with [100ms, 200ms, 400ms] backoff
 *    e) Return response with notificationTriggered flag
 * 
 * Response includes:
 * - notificationTriggered: boolean (Issue #87 Acceptance Criteria)
 * - notificationId: string (for audit trail)
 * 
 * DFD Flows:
 * - f05: 4.4 → 4.5 (validated committee forwarded)
 * - f06: 4.5 → D3 (write published record)
 * - f09: 4.5 → Notification Service (dispatch notifications) - Issue #87
 * - f08: 4.5 → Coordinator (publish status + notification flag)
 * 
 * OpenAPI: POST /committees/{committeeId}/publish → CommitteePublish schema
 *   - Returns notificationTriggered (boolean)
 */
router.post('/:committeeId/publish', authorize(['coordinator']), publishCommitteeHandler);

/**
 * Get Committee
 * GET /api/v1/committees/:committeeId
 */
router.get(
  '/:committeeId',
  authorize(['coordinator', 'advisor', 'jury', 'student']),
  getCommitteeHandler
);

module.exports = router;
