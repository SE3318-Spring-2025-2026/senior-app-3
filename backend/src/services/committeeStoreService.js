const Committee = require('../models/Committee');
const Group = require('../models/Group');
const User = require('../models/User');
const mongoose = require('mongoose');

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
  return Committee.findOne({ committeeId }).lean();
};

/**
 * D3 write op (4.2): assign advisors to committee.
 */
const assignAdvisorsToCommittee = async (committeeId, advisorIds) => {
  const uniqueAdvisorIds = [...new Set(advisorIds)];

  // Bulk validate user existence and role
  const existingUsers = await User.find({
    userId: { $in: uniqueAdvisorIds },
    role: 'professor',
    accountStatus: 'active',
  }).select('userId').lean();

  const validUserSet = new Set(existingUsers.map(u => u.userId));
  const invalidUserIds = uniqueAdvisorIds.filter(id => !validUserSet.has(id));

  if (invalidUserIds.length > 0) {
    const error = new Error(`Invalid advisor IDs: ${invalidUserIds.join(', ')} (must be active professors)`);
    error.code = 'INVALID_ADVISOR_IDS';
    error.status = 409;
    throw error;
  }

  // Bulk validate advisor assignment status
  const assignedGroups = await Group.find({
    advisorId: { $in: uniqueAdvisorIds },
    status: 'active',
  }).select('advisorId').lean();

  const validAdvisorSet = new Set(assignedGroups.map(g => g.advisorId));
  const invalidIds = uniqueAdvisorIds.filter(id => !validAdvisorSet.has(id));

  if (invalidIds.length > 0) {
    const error = new Error(`Invalid advisor IDs: ${invalidIds.join(', ')}`);
    error.code = 'INVALID_ADVISOR_IDS';
    error.status = 409;
    throw error;
  }

  // Check for conflicts with other committees
  const conflictingCommittees = await Committee.find({
    advisorIds: { $in: uniqueAdvisorIds },
    committeeId: { $ne: committeeId },
  }).select('committeeId committeeName advisorIds').lean();

  if (conflictingCommittees.length > 0) {
    const conflictDetails = conflictingCommittees.map(c => `${c.committeeName} (${c.committeeId})`).join(', ');
    const error = new Error(`Advisor conflict detected with committees: ${conflictDetails}`);
    error.code = 'ADVISOR_CONFLICT';
    error.status = 409;
    throw error;
  }

  // Atomic update with transaction
  const session = await mongoose.startSession();
  try {
    let committee;
    await session.withTransaction(async () => {
      committee = await Committee.findOne({ committeeId }).session(session);
      if (!committee) {
        const error = new Error('Committee not found');
        error.code = 'COMMITTEE_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      committee.advisorIds = uniqueAdvisorIds;
      committee.status = 'validated'; // f03 forwarding to Process 4.4
      await committee.save({ session });
    });
    return committee;
  } finally {
    session.endSession();
  }
};

module.exports = {
  createCommitteeDraft,
  publishCommitteeRecord,
  getCommitteeById,
  assignAdvisorsToCommittee,
};
