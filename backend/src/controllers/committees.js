const Committee = require('../models/Committee');
const User = require('../models/User');

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatCommittee = (committee) => ({
  committeeId: committee.committeeId,
  committeeName: committee.committeeName,
  description: committee.description,
  coordinatorId: committee.coordinatorId,
  advisorIds: committee.advisorIds || [],
  juryIds: committee.juryIds || [],
  status: committee.status,
  createdAt: committee.createdAt,
  updatedAt: committee.updatedAt,
  publishedAt: committee.publishedAt || null,
});

const createCommittee = async (req, res) => {
  try {
    const { committeeName, description, coordinatorId } = req.body;

    if (!committeeName || typeof committeeName !== 'string' || !committeeName.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'committeeName is required and must be a non-empty string.',
      });
    }

    if (!coordinatorId || typeof coordinatorId !== 'string' || !coordinatorId.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'coordinatorId is required.',
      });
    }

    if (coordinatorId !== req.user.userId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'coordinatorId must match the authenticated user.',
      });
    }

    const normalizedName = committeeName.trim();
    const existing = await Committee.findOne({
      committeeName: { $regex: new RegExp(`^${escapeRegExp(normalizedName)}$`, 'i') },
    });

    if (existing) {
      return res.status(409).json({
        code: 'COMMITTEE_NAME_TAKEN',
        message: `A committee named "${normalizedName}" already exists. Please choose a different name.`,
      });
    }

    const committee = new Committee({
      committeeName: normalizedName,
      description: description && typeof description === 'string' ? description.trim() : null,
      coordinatorId: coordinatorId.trim(),
    });

    await committee.save();

    return res.status(201).json(formatCommittee(committee));
  } catch (error) {
    console.error('createCommittee error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to create committee.',
    });
  }
};

const listCommittees = async (req, res) => {
  try {
    const committees = await Committee.find({}).sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      committees: committees.map(formatCommittee),
    });
  } catch (error) {
    console.error('listCommittees error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch committees.',
    });
  }
};

const listCommitteeCandidates = async (req, res) => {
  try {
    const professors = await User.find({ role: 'professor', accountStatus: 'active' })
      .select('userId email role')
      .lean();

    const mapped = professors.map((prof) => ({
      userId: prof.userId,
      email: prof.email,
      role: prof.role,
    }));

    return res.status(200).json({ professors: mapped });
  } catch (error) {
    console.error('listCommitteeCandidates error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to load committee candidates.',
    });
  }
};

const validateCommitteeSetupInternal = async (committee) => {
  const advisorIds = Array.isArray(committee.advisorIds) ? committee.advisorIds : [];
  const juryIds = Array.isArray(committee.juryIds) ? committee.juryIds : [];
  const missingRequirements = [];

  if (advisorIds.length === 0) {
    missingRequirements.push('At least one advisor must be assigned.');
  }

  if (juryIds.length === 0) {
    missingRequirements.push('At least one jury member must be assigned.');
  }

  const overlap = advisorIds.filter((id) => juryIds.includes(id));
  if (overlap.length > 0) {
    missingRequirements.push('A person cannot be assigned as both advisor and jury member.');
  }

  const allIds = [...new Set([...advisorIds, ...juryIds])];
  if (allIds.length > 0) {
    const resolved = await User.find({ userId: { $in: allIds }, accountStatus: 'active' }).select('userId').lean();
    const resolvedIds = resolved.map((user) => user.userId);
    const invalidIds = allIds.filter((id) => !resolvedIds.includes(id));
    if (invalidIds.length > 0) {
      missingRequirements.push('Some selected committee members are invalid or inactive.');
    }
  }

  const valid = missingRequirements.length === 0;
  return { valid, missingRequirements, checkedAt: new Date().toISOString() };
};

const assignCommitteeAdvisors = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;

    if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'advisorIds must be a non-empty array of user IDs.',
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
        message: 'Published committees cannot be modified.',
      });
    }

    const normalizedAdvisorIds = Array.from(new Set(advisorIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())));

    if (normalizedAdvisorIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'advisorIds must contain at least one valid user ID.',
      });
    }

    if (normalizedAdvisorIds.some((id) => committee.juryIds.includes(id))) {
      return res.status(409).json({
        code: 'ROLE_CONFLICT',
        message: 'One or more advisors are already assigned as jury members.',
      });
    }

    const validUsers = await User.find({ userId: { $in: normalizedAdvisorIds }, accountStatus: 'active' }).select('userId').lean();
    const validIds = validUsers.map((user) => user.userId);
    if (validIds.length !== normalizedAdvisorIds.length) {
      return res.status(400).json({
        code: 'INVALID_ADVISOR_IDS',
        message: 'Some advisor IDs are invalid or inactive.',
      });
    }

    committee.advisorIds = normalizedAdvisorIds;
    if (committee.status === 'validated') {
      committee.status = 'draft';
    }
    await committee.save();

    return res.status(200).json(formatCommittee(committee));
  } catch (error) {
    console.error('assignCommitteeAdvisors error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to assign advisors.',
    });
  }
};

const addCommitteeJuryMembers = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { juryIds } = req.body;

    if (!Array.isArray(juryIds) || juryIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'juryIds must be a non-empty array of user IDs.',
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
        message: 'Published committees cannot be modified.',
      });
    }

    const normalizedJuryIds = Array.from(new Set(juryIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())));

    if (normalizedJuryIds.length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'juryIds must contain at least one valid user ID.',
      });
    }

    if (normalizedJuryIds.some((id) => committee.advisorIds.includes(id))) {
      return res.status(409).json({
        code: 'ROLE_CONFLICT',
        message: 'One or more jury members are already assigned as advisors.',
      });
    }

    const validUsers = await User.find({ userId: { $in: normalizedJuryIds }, accountStatus: 'active' }).select('userId').lean();
    const validIds = validUsers.map((user) => user.userId);
    if (validIds.length !== normalizedJuryIds.length) {
      return res.status(400).json({
        code: 'INVALID_JURY_IDS',
        message: 'Some jury member IDs are invalid or inactive.',
      });
    }

    committee.juryIds = normalizedJuryIds;
    if (committee.status === 'validated') {
      committee.status = 'draft';
    }
    await committee.save();

    return res.status(200).json(formatCommittee(committee));
  } catch (error) {
    console.error('addCommitteeJuryMembers error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to add jury members.',
    });
  }
};

const validateCommitteeSetup = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const committee = await Committee.findOne({ committeeId });
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found.',
      });
    }

    const validation = await validateCommitteeSetupInternal(committee);

    if (validation.valid && committee.status !== 'published') {
      committee.status = 'validated';
      await committee.save();
    }

    return res.status(200).json({
      committeeId: committee.committeeId,
      valid: validation.valid,
      missingRequirements: validation.missingRequirements,
      checkedAt: validation.checkedAt,
    });
  } catch (error) {
    console.error('validateCommitteeSetup error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to validate committee setup.',
    });
  }
};

const publishCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;
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
        message: 'Committee is already published.',
      });
    }

    const validation = await validateCommitteeSetupInternal(committee);
    if (!validation.valid) {
      return res.status(400).json({
        code: 'COMMITTEE_SETUP_INVALID',
        message: 'Committee setup is incomplete or invalid.',
        missingRequirements: validation.missingRequirements,
      });
    }

    committee.status = 'published';
    committee.publishedAt = new Date();
    await committee.save();

    return res.status(200).json({
      committeeId: committee.committeeId,
      status: 'published',
      publishedAt: committee.publishedAt.toISOString(),
      notificationTriggered: true,
    });
  } catch (error) {
    console.error('publishCommittee error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to publish committee.',
    });
  }
};

module.exports = {
  createCommittee,
  listCommittees,
  listCommitteeCandidates,
  assignCommitteeAdvisors,
  addCommitteeJuryMembers,
  validateCommitteeSetup,
  publishCommittee,
};
