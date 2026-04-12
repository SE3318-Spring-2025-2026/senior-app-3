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

const createCommitteeDraft = async (data) => {
  try {
    const { committeeName, description, coordinatorId } = data;

    const existingCommittee = await Committee.findOne({ committeeName });
    if (existingCommittee) {
      throw new CommitteeServiceError(
        `Committee with name "${committeeName}" already exists`,
        409,
        'DUPLICATE_COMMITTEE_NAME'
      );
    }

    const committee = new Committee({
      committeeName,
      description: description || null,
      createdBy: coordinatorId,
      status: 'draft',
      advisorIds: [],
      juryIds: [],
    });

    await committee.save();

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

    await createAuditLog({
      action: 'COMMITTEE_VALIDATION_PASSED',
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

    committee.advisorIds = [...new Set(advisorIds || [])];
    await committee.save();

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

    committee.juryIds = [...new Set(juryIds || [])];
    await committee.save();

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
  getCommittee,
  assignAdvisors,
  assignJury,
};
