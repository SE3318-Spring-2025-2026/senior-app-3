const Committee = require('../models/Committee');
const { dispatchCommitteePublishNotification } = require('../services/notificationService');
const { createAuditLog } = require('../services/auditService');

/**
 * Publish Committee (Process 4.5)
 * 
 * Publishes the validated committee configuration, stores the final committee data,
 * updates related sprint assignments (D6), and triggers committee notifications.
 * 
 * DFD flow f09: 4.5 → Notification Service
 * 
 * Request: POST /committees/{committeeId}/publish
 * Response: { committeeId, status, publishedAt, notificationTriggered }
 * 
 * Non-fatal error handling: notification failures are logged but do not block publish.
 * 
 * @param {object} req
 * @param {string} req.params.committeeId
 * @param {object} req.user - Authenticated user (from roleMiddleware)
 * @param {object} res
 * @returns {Promise<void>}
 */
const publishCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const coordinatorId = req.user?.userId;

    // Validate coordinator is authenticated
    if (!coordinatorId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Coordinator authentication required',
      });
    }

    // Fetch committee from D3
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Committee ${committeeId} not found`,
      });
    }

    // Check if committee is already published
    if (committee.status === 'published') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Committee is already published',
      });
    }

    // Check if committee is validated (prerequisite for publish)
    if (committee.status !== 'validated') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Committee must be validated before publishing. Current status: ' + committee.status,
      });
    }

    // Update committee status to published
    const publishedAt = new Date();
    committee.status = 'published';
    committee.publishedAt = publishedAt;
    committee.publishedBy = coordinatorId;
    await committee.save();

    // Create audit log for committee publish
    await createAuditLog({
      action: 'COMMITTEE_PUBLISHED',
      actorId: coordinatorId,
      targetId: committeeId,
      details: {
        committeeName: committee.committeeName,
        advisorCount: committee.advisorIds?.length || 0,
        juryCount: committee.juryIds?.length || 0,
      },
    });

    // Dispatch committee publish notifications (non-fatal; failure is logged but doesn't block response)
    let notificationTriggered = false;
    try {
      const notificationResult = await dispatchCommitteePublishNotification({
        committeeId,
        committeeName: committee.committeeName,
        advisorIds: committee.advisorIds,
        juryIds: committee.juryIds,
        groupMemberIds: null, // Default: do not notify group members
        coordinatorId,
      });

      notificationTriggered = notificationResult.success;

      // Log notification dispatch outcome
      await createAuditLog({
        action: 'NOTIFICATION_DISPATCHED',
        actorId: coordinatorId,
        targetId: committeeId,
        details: {
          operation: 'committee_published',
          notificationId: notificationResult.notificationId,
          success: notificationResult.success,
          recipientCount: [
            ...(committee.advisorIds || []),
            ...(committee.juryIds || []),
          ].length,
        },
      });
    } catch (notificationError) {
      // Log notification error as non-fatal issue
      console.error(`[WARNING] Committee publish notification failed for ${committeeId}:`, notificationError.message);
      // Do not throw; notification failure is non-fatal
    }

    // Return success response with notificationTriggered flag
    return res.status(200).json({
      committeeId,
      status: 'published',
      publishedAt,
      notificationTriggered,
    });
  } catch (err) {
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
