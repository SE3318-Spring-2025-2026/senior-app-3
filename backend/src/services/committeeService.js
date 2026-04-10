const Committee = require('../models/Committee');
const { createAuditLog } = require('./auditService');

/**
 * Custom error class for committee service operations
 */
class CommitteeServiceError extends Error {
  constructor(message, status = 500, code = 'COMMITTEE_ERROR') {
    super(message);
    this.name = 'CommitteeServiceError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Create a new committee draft.
 * Called by Process 4.1 (Create Committee).
 * 
 * @param {object} data - Committee creation data
 * @param {string} data.committeeName - Committee name (must be unique)
 * @param {string} data.description - Optional committee description
 * @param {string} data.coordinatorId - Coordinator creating the committee
 * @returns {Promise<object>} Created Committee document
 * @throws {CommitteeServiceError} If name already exists (409) or other errors
 */
const createCommitteeDraft = async (data) => {
  try {
    const { committeeName, description, coordinatorId } = data;

    // Check if committee with same name already exists
    const existingCommittee = await Committee.findOne({ committeeName });
    if (existingCommittee) {
      throw new CommitteeServiceError(
        `Committee with name "${committeeName}" already exists`,
        409,
        'DUPLICATE_COMMITTEE_NAME'
      );
    }

    // Create new committee draft
    const committee = new Committee({
      committeeName,
      description: description || null,
      createdBy: coordinatorId,
      status: 'draft',
      advisorIds: [],
      juryIds: [],
    });

    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_CREATED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        committeeName: committee.committeeName,
        status: 'draft',
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to create committee draft: ${err.message}`,
      500,
      'DRAFT_CREATION_ERROR'
    );
  }
};

/**
 * Validate committee setup (set status to validated).
 * Called by Process 4.4 (Validate Committee Setup).
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string} coordinatorId - Coordinator performing validation
 * @returns {Promise<object>} Updated Committee document
 * @throws {CommitteeServiceError} If committee not found (404) or already published (409)
 */
const validateCommittee = async (committeeId, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Cannot validate an already published committee',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    committee.status = 'validated';
    committee.validatedAt = new Date();
    committee.validatedBy = coordinatorId;
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_VALIDATED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        committeeName: committee.committeeName,
        advisorCount: committee.advisorIds.length,
        juryCount: committee.juryIds.length,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to validate committee: ${err.message}`,
      500,
      'VALIDATION_ERROR'
    );
  }
};

/**
 * Publish a validated committee (set status to published).
 * Called by Process 4.5 (Publish Committee) - Flow f06: 4.5 → D3.
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string} coordinatorId - Coordinator publishing the committee
 * @returns {Promise<object>} Updated Committee document
 * @throws {CommitteeServiceError} If committee not found (404), not validated (400), or already published (409)
 */
const publishCommittee = async (committeeId, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Committee is already published',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    if (committee.status !== 'validated') {
      throw new CommitteeServiceError(
        'Committee must be validated before publishing',
        400,
        'COMMITTEE_NOT_VALIDATED'
      );
    }

    committee.status = 'published';
    committee.publishedAt = new Date();
    committee.publishedBy = coordinatorId;
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_PUBLISHED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        committeeName: committee.committeeName,
        advisorCount: committee.advisorIds.length,
        juryCount: committee.juryIds.length,
        publishedAt: committee.publishedAt,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to publish committee: ${err.message}`,
      500,
      'PUBLISH_ERROR'
    );
  }
};

/**
 * Retrieve a committee by ID.
 * Used for validation and status checks.
 * 
 * @param {string} committeeId - Committee identifier
 * @returns {Promise<object>} Committee document or null if not found
 */
const getCommittee = async (committeeId) => {
  try {
    return await Committee.findOne({ committeeId });
  } catch (err) {
    throw new CommitteeServiceError(
      `Failed to retrieve committee: ${err.message}`,
      500,
      'RETRIEVE_ERROR'
    );
  }
};

/**
 * Assign advisors to a committee.
 * Called by Process 4.2 (Assign Advisors).
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string[]} advisorIds - Array of advisor user IDs
 * @param {string} coordinatorId - Coordinator performing assignment
 * @returns {Promise<object>} Updated Committee document
 */
const assignAdvisors = async (committeeId, advisorIds, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Cannot modify a published committee',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    // Remove duplicates and ensure it's an array
    committee.advisorIds = [...new Set(advisorIds || [])];
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_ADVISORS_ASSIGNED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        advisorCount: committee.advisorIds.length,
        advisorIds: committee.advisorIds,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to assign advisors: ${err.message}`,
      500,
      'ASSIGN_ADVISORS_ERROR'
    );
  }
};

/**
 * Assign jury members to a committee.
 * Called by Process 4.3 (Add Jury Members).
 * 
 * @param {string} committeeId - Committee identifier
 * @param {string[]} juryIds - Array of jury member user IDs
 * @param {string} coordinatorId - Coordinator performing assignment
 * @returns {Promise<object>} Updated Committee document
 */
const assignJury = async (committeeId, juryIds, coordinatorId) => {
  try {
    const committee = await Committee.findOne({ committeeId });

    if (!committee) {
      throw new CommitteeServiceError(
        `Committee ${committeeId} not found`,
        404,
        'COMMITTEE_NOT_FOUND'
      );
    }

    if (committee.status === 'published') {
      throw new CommitteeServiceError(
        'Cannot modify a published committee',
        409,
        'COMMITTEE_ALREADY_PUBLISHED'
      );
    }

    // Remove duplicates and ensure it's an array
    committee.juryIds = [...new Set(juryIds || [])];
    await committee.save();

    // Audit log
    await createAuditLog({
      action: 'COMMITTEE_JURY_ASSIGNED',
      actorId: coordinatorId,
      payload: {
        committeeId: committee.committeeId,
        juryCount: committee.juryIds.length,
        juryIds: committee.juryIds,
      },
    });

    return committee;
  } catch (err) {
    if (err instanceof CommitteeServiceError) {
      throw err;
    }
    throw new CommitteeServiceError(
      `Failed to assign jury: ${err.message}`,
      500,
      'ASSIGN_JURY_ERROR'
    );
  }
};

module.exports = {
  CommitteeServiceError,
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
};
