const {
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  assignAdvisors,
  assignJury,
  CommitteeServiceError,
} = require('../services/committeeService');
const { dispatchCommitteePublishNotification } = require('../services/notificationService');

/**
 * Create a new committee in draft status
 * POST /api/v1/committees
 */
const createCommittee = async (req, res) => {
  try {
    const { committeeName, description, advisorIds, juryIds } = req.body;
    const coordinatorId = req.user?.userId;

    // Validate required fields
    if (!committeeName) {
      return res.status(400).json({ error: 'Committee name is required' });
    }

    if (committeeName.length < 3 || committeeName.length > 100) {
      return res.status(400).json({
        error: 'Committee name must be between 3 and 100 characters',
      });
    }

    const committee = await createCommitteeDraft(committeeName, coordinatorId, {
      description,
      advisorIds: advisorIds || [],
      juryIds: juryIds || [],
    });

    res.status(201).json(committee);
  } catch (error) {
    if (error instanceof CommitteeServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Create committee error:', error);
    res.status(500).json({ error: 'Failed to create committee' });
  }
};

/**
 * Validate committee setup
 * POST /api/v1/committees/{committeeId}/validate
 */
const validateCommitteeHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;

    if (!committeeId) {
      return res.status(400).json({ error: 'Committee ID is required' });
    }

    const committee = await validateCommittee(committeeId);
    res.status(200).json(committee);
  } catch (error) {
    if (error instanceof CommitteeServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Validate committee error:', error);
    res.status(500).json({ error: 'Failed to validate committee' });
  }
};

/**
 * Publish committee
 * POST /api/v1/committees/{committeeId}/publish
 */
const publishCommitteeHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const publishedBy = req.user?.userId;

    if (!committeeId) {
      return res.status(400).json({ error: 'Committee ID is required' });
    }

    const committee = await publishCommittee(committeeId, publishedBy);

    // Dispatch notification to advisors and jury (async, non-blocking)
    dispatchCommitteePublishNotification(committee, publishedBy)
      .then((result) => {
        console.log('[Notification] Committee publication notification dispatched:', result);
      })
      .catch((error) => {
        console.error('[Notification] Failed to dispatch notification:', error);
      });

    res.status(200).json({
      committeeId: committee.committeeId,
      status: committee.status,
      publishedAt: committee.publishedAt,
      notificationTriggered: true,
    });
  } catch (error) {
    if (error instanceof CommitteeServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Publish committee error:', error);
    res.status(500).json({ error: 'Failed to publish committee' });
  }
};

/**
 * Assign advisors to committee
 * POST /api/v1/committees/{committeeId}/advisors
 */
const assignAdvisorsHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;

    if (!committeeId) {
      return res.status(400).json({ error: 'Committee ID is required' });
    }

    if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
      return res.status(400).json({
        error: 'advisorIds must be a non-empty array',
      });
    }

    const committee = await assignAdvisors(committeeId, advisorIds);
    res.status(200).json(committee);
  } catch (error) {
    if (error instanceof CommitteeServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Assign advisors error:', error);
    res.status(500).json({ error: 'Failed to assign advisors' });
  }
};

/**
 * Assign jury members to committee
 * POST /api/v1/committees/{committeeId}/jury
 */
const assignJuryHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;

    if (!committeeId) {
      return res.status(400).json({ error: 'Committee ID is required' });
    }

    if (!Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json({
        error: 'juryIds must be a non-empty array',
      });
    }

    const committee = await assignJury(committeeId, juryIds);
    res.status(200).json(committee);
  } catch (error) {
    if (error instanceof CommitteeServiceError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Assign jury error:', error);
    res.status(500).json({ error: 'Failed to assign jury' });
  }
};

module.exports = {
  createCommittee,
  validateCommitteeHandler,
  publishCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
};
