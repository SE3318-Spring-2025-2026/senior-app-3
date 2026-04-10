const {
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
} = require('../services/committeeService');
const { responseFormatter } = require('../utils/responseFormatter');

/**
 * POST /api/v1/committees - Create committee draft (Process 4.1)
 */
const createCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeName, description } = req.body;
    const coordinatorId = req.user?.id;

    if (!committeeName || typeof committeeName !== 'string' || committeeName.trim().length === 0) {
      return res.status(400).json(
        responseFormatter(false, 'Committee name is required', null, 400)
      );
    }

    const committee = await createCommitteeDraft(committeeName, coordinatorId, {
      description,
    });

    res.status(201).json(
      responseFormatter(true, 'Committee created successfully', committee, 201)
    );
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(responseFormatter(false, error.message, null, status));
  }
};

/**
 * POST /api/v1/committees/:committeeId/advisors - Assign advisors (Process 4.2)
 */
const assignAdvisorsHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;

    if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
      return res.status(400).json(
        responseFormatter(false, 'advisorIds must be a non-empty array', null, 400)
      );
    }

    const committee = await assignAdvisors(committeeId, advisorIds);

    res.status(200).json(
      responseFormatter(true, 'Advisors assigned successfully', committee, 200)
    );
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(responseFormatter(false, error.message, null, status));
  }
};

/**
 * POST /api/v1/committees/:committeeId/jury - Assign jury members (Process 4.3)
 */
const assignJuryHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;

    if (!Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json(
        responseFormatter(false, 'juryIds must be a non-empty array', null, 400)
      );
    }

    const committee = await assignJury(committeeId, juryIds);

    res.status(200).json(
      responseFormatter(true, 'Jury members assigned successfully', committee, 200)
    );
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(responseFormatter(false, error.message, null, status));
  }
};

/**
 * POST /api/v1/committees/:committeeId/validate - Validate committee setup (Process 4.4)
 */
const validateCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;

    const committee = await validateCommittee(committeeId);

    res.status(200).json(
      responseFormatter(true, 'Committee validated successfully', committee, 200)
    );
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(responseFormatter(false, error.message, null, status));
  }
};

/**
 * Issue #87: Publish Committee Handler - Process 4.5
 * 
 * This handler implements the final step of committee assignment workflow
 * with integration to Notification Service (Flow f09).
 * 
 * HTTP Contract:
 * - Request: POST /api/v1/committees/:committeeId/publish
 * - Authorization: Coordinator only (403 Forbidden for others)
 * - Status Codes:
 *   - 200: Success (committee published, notificationTriggered flag in response)
 *   - 400: Committee not validated or setup incomplete
 *   - 403: Unauthorized (non-coordinator)
 *   - 404: Committee not found
 *   - 409: Committee already published
 * 
 * Response Schema (OpenAPI: CommitteePublish):
 * {
 *   "status": true,
 *   "message": "Committee published successfully",
 *   "data": {
 *     "committeeId": "COMM_...",
 *     "committeeName": "Spring 2025 Senior Projects",
 *     "status": "published",
 *     "publishedAt": "2026-04-11T...",
 *     "notificationTriggered": true,           // Issue #87: CRITICAL FLAG
 *     "notificationId": "notif_..." or null
 *   }
 * }
 * 
 * Issue #87 Specific Behavior:
 * 1. If notification dispatch succeeds: notificationTriggered = true
 * 2. If notification dispatch fails after retries: notificationTriggered = false
 * 3. Committee is ALWAYS published regardless of notification status (partial failure)
 * 4. Coordinator receives flag to verify notification delivery
 * 5. Manual retry of notification can be done via support/admin tools
 */
const publishCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;
    const publishedBy = req.user?.id;

    const result = await publishCommittee(committeeId, publishedBy);

    res.status(200).json(
      responseFormatter(true, 'Committee published successfully', {
        committeeId: result.committeeId,
        committeeName: result.committeeName,
        status: result.status,
        publishedAt: result.publishedAt,
        /**
         * Issue #87: Notification Triggered Flag in Response
         * 
         * This is the primary way coordinator verifies Issue #87 implementation.
         * - true: All notification recipients queued successfully
         * - false: Notification dispatch failed, but committee is still published
         * 
         * OpenAPI requires this field in CommitteePublish schema.
         */
        notificationTriggered: result.notificationTriggered,
        notificationId: result.notificationId,
      }, 200)
    );
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(responseFormatter(false, error.message, null, status));
  }
};

/**
 * GET /api/v1/committees/:committeeId - Get committee details
 */
const getCommitteeHandler = async (req, res, next) => {
  try {
    const { committeeId } = req.params;

    const committee = await getCommittee(committeeId);

    res.status(200).json(
      responseFormatter(true, 'Committee retrieved successfully', committee, 200)
    );
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(responseFormatter(false, error.message, null, status));
  }
};

module.exports = {
  createCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
  validateCommitteeHandler,
  publishCommitteeHandler,
  getCommitteeHandler,
};
