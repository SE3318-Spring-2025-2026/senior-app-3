const {
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
  CommitteeServiceError,
} = require('../services/committeeService');

/**
 * Create a new committee draft.
 * Process 4.1 (Create Committee)
 * 
 * @param {object} req - Express request
 * @param {object} req.body - Request body
 * @param {string} req.body.committeeName - Committee name
 * @param {string} req.body.description - Optional description
 * @param {object} req.user - Authenticated user
 * @param {string} req.user.userId - Coordinator user ID
 * @param {object} res - Express response
 */
const createCommittee = async (req, res) => {
  try {
    const { committeeName, description } = req.body;
    const coordinatorId = req.user?.userId;

    // Validate required fields
    if (!committeeName || typeof committeeName !== 'string') {
      return res.status(400).json({
        code: 'INVALID_COMMITTEE_NAME',
        message: 'Committee name is required and must be a string',
      });
    }

    if (committeeName.length < 3 || committeeName.length > 100) {
      return res.status(400).json({
        code: 'INVALID_NAME_LENGTH',
        message: 'Committee name must be between 3 and 100 characters',
      });
    }

    // Create committee draft
    const committee = await createCommitteeDraft({
      committeeName,
      description: description || null,
      coordinatorId,
    });

    return res.status(201).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      createdAt: committee.createdAt,
      updatedAt: committee.updatedAt,
    });
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    console.error('Committee creation error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during committee creation',
    });
  }
};

/**
 * Validate committee setup.
 * Process 4.4 (Validate Committee Setup)
 * 
 * @param {object} req - Express request
 * @param {string} req.params.committeeId - Committee ID
 * @param {object} req.user - Authenticated user
 * @param {string} req.user.userId - Coordinator user ID
 * @param {object} res - Express response
 */
const validateCommitteeHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const coordinatorId = req.user?.userId;

    if (!committeeId) {
      return res.status(400).json({
        code: 'MISSING_COMMITTEE_ID',
        message: 'Committee ID is required',
      });
    }

    // Fetch current committee
    const committee = await getCommittee(committeeId);

    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: `Committee ${committeeId} not found`,
      });
    }

    // Perform validation checks
    const missingRequirements = [];

    if (!committee.advisorIds || committee.advisorIds.length === 0) {
      missingRequirements.push('At least one advisor must be assigned');
    }

    if (!committee.juryIds || committee.juryIds.length === 0) {
      missingRequirements.push('At least one jury member must be assigned');
    }

    // Check for conflicts (same person as advisor and jury)
    if (committee.advisorIds && committee.juryIds) {
      const conflictingMembers = committee.advisorIds.filter((id) =>
        committee.juryIds.includes(id)
      );
      if (conflictingMembers.length > 0) {
        missingRequirements.push(
          `${conflictingMembers.length} member(s) are assigned as both advisor and jury`
        );
      }
    }

    const isValid = missingRequirements.length === 0;

    // If valid, update committee status to validated
    if (isValid) {
      await validateCommittee(committeeId, coordinatorId);
    }

    return res.status(200).json({
      committeeId,
      valid: isValid,
      missingRequirements,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    console.error('Committee validation error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during committee validation',
    });
  }
};

/**
 * Publish a validated committee.
 * Process 4.5 (Publish Committee) - Flow f06: 4.5 → D3
 * 
 * @param {object} req - Express request
 * @param {string} req.params.committeeId - Committee ID
 * @param {object} req.user - Authenticated user
 * @param {string} req.user.userId - Coordinator user ID
 * @param {object} res - Express response
 */
const publishCommitteeHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const coordinatorId = req.user?.userId;

    if (!committeeId) {
      return res.status(400).json({
        code: 'MISSING_COMMITTEE_ID',
        message: 'Committee ID is required',
      });
    }

    // Publish committee
    const committee = await publishCommittee(committeeId, coordinatorId);

    return res.status(200).json({
      committeeId: committee.committeeId,
      status: committee.status,
      publishedAt: committee.publishedAt,
      notificationTriggered: true, // Set to true; actual notification logic in Issue #81
    });
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    console.error('Committee publish error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during committee publication',
    });
  }
};

/**
 * Assign advisors to a committee.
 * Process 4.2 (Assign Advisors)
 * 
 * @param {object} req - Express request
 * @param {string} req.params.committeeId - Committee ID
 * @param {object} req.body - Request body
 * @param {string[]} req.body.advisorIds - Array of advisor IDs
 * @param {object} req.user - Authenticated user
 * @param {object} res - Express response
 */
const assignAdvisorsHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;
    const coordinatorId = req.user?.userId;

    if (!committeeId) {
      return res.status(400).json({
        code: 'MISSING_COMMITTEE_ID',
        message: 'Committee ID is required',
      });
    }

    if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_ADVISORS',
        message: 'advisorIds must be a non-empty array',
      });
    }

    // Assign advisors
    const committee = await assignAdvisors(committeeId, advisorIds, coordinatorId);

    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      createdAt: committee.createdAt,
      updatedAt: committee.updatedAt,
    });
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    console.error('Advisor assignment error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during advisor assignment',
    });
  }
};

/**
 * Assign jury members to a committee.
 * Process 4.3 (Add Jury Members)
 * 
 * @param {object} req - Express request
 * @param {string} req.params.committeeId - Committee ID
 * @param {object} req.body - Request body
 * @param {string[]} req.body.juryIds - Array of jury member IDs
 * @param {object} req.user - Authenticated user
 * @param {object} res - Express response
 */
const assignJuryHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;
    const coordinatorId = req.user?.userId;

    if (!committeeId) {
      return res.status(400).json({
        code: 'MISSING_COMMITTEE_ID',
        message: 'Committee ID is required',
      });
    }

    if (!Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_JURY',
        message: 'juryIds must be a non-empty array',
      });
    }

    // Assign jury
    const committee = await assignJury(committeeId, juryIds, coordinatorId);

    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      createdAt: committee.createdAt,
      updatedAt: committee.updatedAt,
    });
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
      });
    }

    console.error('Jury assignment error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during jury assignment',
    });
  }
};

module.exports = {
  createCommittee,
  validateCommitteeHandler,
  publishCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
};
