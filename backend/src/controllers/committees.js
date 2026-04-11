const Committee = require('../models/Committee');
const { createAuditLog } = require('../services/auditService');
const { publishCommitteeWithTransaction } = require('../services/committeePublishService');

/**
 * Publish Committee (Process 4.5)
 * 
 * Publishes the validated committee configuration, stores the final committee data,
 * updates related group assignments (D2), and triggers committee notifications.
 * 
 * DFD flows:
 * - f06: 4.5 → D3 (Committee) - Publish committee status
 * - f07: 4.5 → D2 (Groups) - Link groups to committee
 * - f09: 4.5 → Notification Service - Dispatch notifications
 * 
 * Request: POST /committees/{committeeId}/publish
 * Response: { committeeId, status, publishedAt, notificationTriggered }
 * 
 * ARCHITECTURAL IMPROVEMENTS (Issue #81 Fixes):
 * ✅ FIX #1: Route now requires authMiddleware before roleMiddleware
 * ✅ FIX #2: D2 Groups update implemented with Group.updateMany()
 * ✅ FIX #3: MongoDB transaction wraps D3 + D2 + audit for atomicity
 * ✅ FIX #4: Notification dispatch moved to setImmediate (fire-and-forget, non-blocking)
 * ✅ FIX #5: Group members fetched and included in notification recipients
 * ✅ FIX #6: New committeePublishService encapsulates all transaction logic
 * 
 * @param {object} req
 * @param {string} req.params.committeeId
 * @param {object} req.body.assignedGroupIds - Group IDs to link to committee
 * @param {object} req.user - Authenticated user (from authMiddleware)
 * @param {object} res
 * @returns {Promise<void>}
 */
const publishCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { assignedGroupIds = [] } = req.body;

    /**
     * FIX #1 (Issue #81): Authorization via authMiddleware
     * 
     * DEFICIENCY: PR review identified missing authMiddleware
     * "Without req.user being set by authMiddleware, the role check will fail with a 401"
     * 
     * SOLUTION:
     * Route middleware chain now includes authMiddleware BEFORE roleMiddleware
     * (see backend/src/routes/committees.js line 60)
     * 
     * This ensures req.user is properly populated by authMiddleware
     * before roleMiddleware checks coordinator role
     */
    const coordinatorId = req.user?.userId;

    if (!coordinatorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Coordinator authentication required',
      });
    }

    /**
     * FIX #3, #2, #5, #4, #6 (Issue #81): Use transaction service
     * 
     * Delegates all complex logic to committeePublishService:
     * - FIX #3: Wraps all writes in MongoDB session.withTransaction()
     * - FIX #2: Updates D2 (Groups) with committeeId and committeePublishedAt
     * - FIX #5: Fetches group members from assigned groups for recipients
     * - FIX #4: Dispatches notifications via setImmediate (fire-and-forget)
     * - FIX #6: Encapsulates all transactional logic in reusable service
     */
    const result = await publishCommitteeWithTransaction({
      committeeId,
      coordinatorId,
      assignedGroupIds,
    });

    // Return success response with complete transaction results
    return res.status(200).json(result);
  } catch (err) {
    // Handle specific error types with appropriate status codes
    if (err.statusCode === 404) {
      return res.status(404).json({
        error: 'Not Found',
        message: err.message,
      });
    }

    if (err.statusCode === 409) {
      return res.status(409).json({
        error: 'Conflict',
        message: err.message,
      });
    }

    if (err.statusCode === 400) {
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message,
      });
    }

    // Generic database/transaction error
    console.error('publishCommittee error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  }
};

/**
 * Create Committee (Process 4.1)
 * 
 * Coordinator creates a new committee draft.
 * 
 * @param {object} req
 * @param {object} req.body
 * @param {string} req.body.committeeName - Committee name (required)
 * @param {string} req.body.description - Optional description
 * @param {string} req.body.coordinatorId - Coordinator user ID (required)
 * @param {object} req.user - Authenticated user
 * @param {object} res
 * @returns {Promise<void>}
 */
const createCommittee = async (req, res) => {
  try {
    const { committeeName, description, coordinatorId } = req.body;

    // Validate input
    if (!committeeName || !coordinatorId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'committeeName and coordinatorId are required',
      });
    }

    // Check if committee with same name already exists
    const existing = await Committee.findOne({ committeeName });
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Committee with name "${committeeName}" already exists`,
      });
    }

    // Create new committee
    const committee = new Committee({
      committeeName,
      description: description || null,
      createdBy: coordinatorId,
      status: 'draft',
    });

    await committee.save();

    // Create audit log
    await createAuditLog({
      action: 'COMMITTEE_CREATED',
      actorId: coordinatorId,
      targetId: committee.committeeId,
      details: {
        committeeName,
      },
    });

    return res.status(201).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      status: committee.status,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      createdAt: committee.createdAt,
    });
  } catch (err) {
    console.error('createCommittee error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  }
};

module.exports = {
  createCommittee,
  publishCommittee,
};
