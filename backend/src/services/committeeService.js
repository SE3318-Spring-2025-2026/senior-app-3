const Committee = require('../models/Committee');
const { createAuditLog } = require('../services/auditLogService');

class CommitteeServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'CommitteeServiceError';
    this.status = status;
  }
}

/**
 * Create a committee in draft status
 * @param {string} committeeName - Name of the committee
 * @param {string} coordinatorId - ID of the coordinator creating the committee
 * @param {object} options - Optional fields (description, advisorIds, juryIds)
 * @returns {Promise<object>} Created committee document
 */
const createCommitteeDraft = async (committeeName, coordinatorId, options = {}) => {
  // Check for duplicate committee name
  const existingCommittee = await Committee.findOne({ committeeName });
  if (existingCommittee) {
    throw new CommitteeServiceError(
      `Committee with name "${committeeName}" already exists`,
      409
    );
  }

  const committeeId = `COMM_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const committee = new Committee({
    committeeId,
    committeeName,
    createdBy: coordinatorId,
    status: 'draft',
    description: options.description || '',
    advisorIds: options.advisorIds || [],
    juryIds: options.juryIds || [],
  });

  await committee.save();

  // Audit log
  await createAuditLog({
    event: 'COMMITTEE_CREATED',
    userId: coordinatorId,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { status: 'draft', committeeName },
  });

  return committee;
};

/**
 * Validate committee setup (advisor count, jury count, etc.)
 * @param {string} committeeId - ID of the committee to validate
 * @returns {Promise<object>} Validation result
 */
const validateCommittee = async (committeeId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Cannot validate a published committee', 409);
  }

  // Validation checks
  const errors = [];
  if (committee.advisorIds.length === 0) {
    errors.push('At least one advisor must be assigned');
  }
  if (committee.juryIds.length === 0) {
    errors.push('At least one jury member must be assigned');
  }

  if (errors.length > 0) {
    throw new CommitteeServiceError(`Validation failed: ${errors.join('; ')}`, 400);
  }

  committee.status = 'validated';
  committee.validatedAt = new Date();
  committee.validatedBy = committee.createdBy; // In production, pass the validator ID
  await committee.save();

  // Audit log
  await createAuditLog({
    event: 'COMMITTEE_VALIDATED',
    userId: committee.createdBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { status: 'validated' },
  });

  return committee;
};

/**
 * Publish committee
 * @param {string} committeeId - ID of the committee to publish
 * @param {string} publishedBy - ID of the user publishing
 * @returns {Promise<object>} Published committee
 */
const publishCommittee = async (committeeId, publishedBy) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status !== 'validated') {
    throw new CommitteeServiceError(
      'Committee must be validated before publishing',
      409
    );
  }

  committee.status = 'published';
  committee.publishedAt = new Date();
  committee.publishedBy = publishedBy;
  await committee.save();

  // Audit log
  await createAuditLog({
    event: 'COMMITTEE_PUBLISHED',
    userId: publishedBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { status: 'published', publishedAt: committee.publishedAt },
  });

  return committee;
};

/**
 * Get committee by ID
 * @param {string} committeeId - ID of the committee
 * @returns {Promise<object>} Committee document
 */
const getCommittee = async (committeeId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }
  return committee;
};

/**
 * Assign advisors to committee
 * @param {string} committeeId - ID of the committee
 * @param {array} advisorIds - Array of advisor user IDs
 * @returns {Promise<object>} Updated committee
 */
const assignAdvisors = async (committeeId, advisorIds) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Cannot modify a published committee', 409);
  }

  // Deduplicate and merge with existing advisors
  const uniqueAdvisors = [...new Set([...committee.advisorIds, ...advisorIds])];
  committee.advisorIds = uniqueAdvisors;
  await committee.save();

  // Audit log
  await createAuditLog({
    event: 'COMMITTEE_ADVISORS_ASSIGNED',
    userId: committee.createdBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { advisorIds: uniqueAdvisors },
  });

  return committee;
};

/**
 * Assign jury members to committee
 * @param {string} committeeId - ID of the committee
 * @param {array} juryIds - Array of jury member user IDs
 * @returns {Promise<object>} Updated committee
 */
const assignJury = async (committeeId, juryIds) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Cannot modify a published committee', 409);
  }

  // Deduplicate and merge with existing jury members
  const uniqueJury = [...new Set([...committee.juryIds, ...juryIds])];
  committee.juryIds = uniqueJury;
  await committee.save();

  // Audit log
  await createAuditLog({
    event: 'COMMITTEE_JURY_ASSIGNED',
    userId: committee.createdBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { juryIds: uniqueJury },
  });

  return committee;
};

module.exports = {
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
  CommitteeServiceError,
};
