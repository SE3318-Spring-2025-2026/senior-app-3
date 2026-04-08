const Committee = require('../models/Committee');

/**
 * D3 write op (4.1): create draft committee record.
 */
const createCommitteeDraft = async ({ committeeName, description = '' }) => {
  const normalizedName = committeeName.trim();

  const existing = await Committee.findOne({
    committeeName: { $regex: new RegExp(`^${normalizedName}$`, 'i') },
  });

  if (existing) {
    const error = new Error(`Committee "${normalizedName}" already exists`);
    error.code = 'COMMITTEE_NAME_EXISTS';
    error.status = 409;
    throw error;
  }

  const created = await Committee.create({
    committeeName: normalizedName,
    description: typeof description === 'string' ? description.trim() : '',
    advisorIds: [],
    juryIds: [],
    status: 'draft',
  });

  return created;
};

/**
 * D3 write op (4.5): mark committee as published.
 */
const publishCommitteeRecord = async (committeeId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    const error = new Error('Committee not found');
    error.code = 'COMMITTEE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  committee.status = 'published';
  committee.publishedAt = new Date();
  await committee.save();
  return committee;
};

/**
 * D3 read op (4.4): fetch committee for validation workflows.
 */
const getCommitteeById = async (committeeId) => {
  return Committee.findOne({ committeeId });
};

module.exports = {
  createCommitteeDraft,
  publishCommitteeRecord,
  getCommitteeById,
};
