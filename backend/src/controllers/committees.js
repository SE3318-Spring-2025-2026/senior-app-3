const Committee = require('../models/Committee');
const User = require('../models/User');

const ALLOWED_JURY_ROLES = new Set(['professor', 'committee_member']);

const normalizeUserId = (value) => (typeof value === 'string' ? value.trim() : '');

const getAllCommittees = async (req, res) => {
  try {
    const committees = await Committee.find().sort({ createdAt: -1 });
    return res.status(200).json({ committees });
  } catch (err) {
    console.error('getAllCommittees error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to retrieve committees.',
    });
  }
};

const getCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;

    const committee = await Committee.findOne({ committeeId });
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found.',
      });
    }

    return res.status(200).json(committee);
  } catch (err) {
    console.error('getCommittee error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to retrieve committee.',
    });
  }
};

const addJuryMembers = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;

    if (!Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'juryIds must be a non-empty array of user IDs.',
      });
    }

    const normalizedIds = juryIds.map(normalizeUserId);
    if (normalizedIds.some((id) => !id)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'All juryIds must be non-empty strings.',
      });
    }

    const uniqueJuryIds = [...new Set(normalizedIds)];
    if (uniqueJuryIds.length !== normalizedIds.length) {
      return res.status(400).json({
        code: 'DUPLICATE_JURY_IDS',
        message: 'juryIds must not contain duplicate user IDs.',
      });
    }

    const committee = await Committee.findOne({ committeeId });
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found.',
      });
    }

    if (committee.status === 'published') {
      return res.status(409).json({
        code: 'COMMITTEE_ALREADY_PUBLISHED',
        message: 'Cannot add jury members to a published committee.',
      });
    }

    const advisorOverlap = uniqueJuryIds.filter((userId) => committee.advisorIds.includes(userId));
    if (advisorOverlap.length > 0) {
      return res.status(409).json({
        code: 'JURY_ADVISOR_CONFLICT',
        message: 'One or more jury members are already assigned as advisors.',
        details: advisorOverlap,
      });
    }

    const existingJuryOverlap = uniqueJuryIds.filter((userId) => committee.juryIds.includes(userId));
    if (existingJuryOverlap.length > 0) {
      return res.status(409).json({
        code: 'JURY_ALREADY_ASSIGNED',
        message: 'One or more jury members are already part of this committee.',
        details: existingJuryOverlap,
      });
    }

    const users = await User.find({ userId: { $in: uniqueJuryIds } });
    const foundIds = new Set(users.map((user) => user.userId));
    const missingIds = uniqueJuryIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        code: 'JURY_MEMBER_NOT_FOUND',
        message: 'One or more jury member IDs do not exist.',
        details: missingIds,
      });
    }

    const invalidRoleUsers = users.filter((user) => !ALLOWED_JURY_ROLES.has(user.role));
    if (invalidRoleUsers.length > 0) {
      return res.status(400).json({
        code: 'INVALID_JURY_MEMBER_ROLE',
        message: 'Jury members must be professors or committee members.',
        details: invalidRoleUsers.map((user) => ({ userId: user.userId, role: user.role })),
      });
    }

    const newJuryIds = uniqueJuryIds.filter((userId) => !committee.juryIds.includes(userId));
    if (newJuryIds.length === 0) {
      return res.status(200).json(committee);
    }

    committee.juryIds.push(...newJuryIds);
    await committee.save();

    return res.status(200).json(committee);
  } catch (err) {
    console.error('addJuryMembers error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to add jury members to committee.',
    });
  }
};

module.exports = {
  getAllCommittees,
  getCommittee,
  addJuryMembers,
};
