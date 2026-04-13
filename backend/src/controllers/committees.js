const { publishCommitteeWithTransaction } = require('../services/committeePublishService');
const Group = require('../models/Group');
const Committee = require('../models/Committee');
const {
  createCommitteeDraft,
  validateCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
  CommitteeServiceError,
} = require('../services/committeeService');

const createCommitteeHandler = async (req, res) => {
  try {
    const { committeeName, description } = req.body;
    const coordinatorId = req.user?.userId;

    if (!committeeName || typeof committeeName !== 'string' || committeeName.trim().length === 0) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Committee name is required',
      });
    }

    if (!coordinatorId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Coordinator authentication required',
      });
    }

    const committee = await createCommitteeDraft({
      committeeName: committeeName.trim(),
      description,
      coordinatorId,
    });

    return res.status(201).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      status: committee.status,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
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
    console.error('createCommittee error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: err.message,
    });
  }
};

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

    if (!coordinatorId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Coordinator authentication required',
      });
    }

    const committee = await getCommittee(committeeId);

    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: `Committee ${committeeId} not found`,
      });
    }

    const missingRequirements = [];

    if (!committee.advisorIds || committee.advisorIds.length === 0) {
      missingRequirements.push('At least one advisor must be assigned');
    }

    if (!committee.juryIds || committee.juryIds.length === 0) {
      missingRequirements.push('At least one jury member must be assigned');
    }

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

    if (!coordinatorId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Coordinator authentication required',
      });
    }

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

    if (!coordinatorId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Coordinator authentication required',
      });
    }

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

const publishCommitteeHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const coordinatorId = req.user?.userId;
    const { assignedGroupIds = [] } = req.body || {};

    if (!coordinatorId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Coordinator authentication required',
      });
    }

    const result = await publishCommitteeWithTransaction({
      committeeId,
      coordinatorId,
      assignedGroupIds,
    });

    return res.status(200).json({
      committeeId: result.committeeId,
      status: result.status,
      publishedAt: result.publishedAt,
      notificationTriggered: result.notificationTriggered,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: err.message,
      });
    }

    if (err.statusCode === 409) {
      return res.status(409).json({
        code: 'COMMITTEE_CONFLICT',
        message: err.message,
      });
    }

    if (err.statusCode === 400) {
      return res.status(400).json({
        code: 'COMMITTEE_INVALID_STATE',
        message: err.message,
      });
    }

    console.error('publishCommittee error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: err.message,
    });
  }
};

const getCommitteeHandler = async (req, res) => {
  try {
    const { committeeId } = req.params;

    const committee = await getCommittee(committeeId);

    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: `Committee ${committeeId} not found`,
      });
    }

    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      createdBy: committee.createdBy,
      publishedAt: committee.publishedAt,
      publishedBy: committee.publishedBy,
      validatedAt: committee.validatedAt,
      validatedBy: committee.validatedBy,
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

    console.error('getCommittee error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: err.message,
    });
  }
};

const getGroupCommitteeStatus = async (req, res) => {
  try {
    const { groupId } = req.params;

    if (!groupId) {
      return res.status(400).json({
        code: 'MISSING_GROUP_ID',
        message: 'Group ID is required',
      });
    }

    const group = await Group.findOne({ groupId }).select(
      'groupId groupName committeeId committeePublishedAt'
    );

    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }

    if (!group.committeeId) {
      return res.status(200).json({
        groupId: group.groupId,
        groupName: group.groupName,
        assigned: false,
        committee: null,
      });
    }

    const committee = await Committee.findOne({ committeeId: group.committeeId }).select(
      'committeeId committeeName status publishedAt validatedAt'
    );

    return res.status(200).json({
      groupId: group.groupId,
      groupName: group.groupName,
      assigned: true,
      committee: committee
        ? {
            committeeId: committee.committeeId,
            committeeName: committee.committeeName,
            status: committee.status,
            validatedAt: committee.validatedAt,
            publishedAt: committee.publishedAt,
          }
        : {
            committeeId: group.committeeId,
            status: 'unknown',
            publishedAt: group.committeePublishedAt,
          },
    });
  } catch (err) {
    console.error('getGroupCommitteeStatus error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch group committee status',
    });
  }
};

module.exports = {
  createCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
  validateCommitteeHandler,
  publishCommitteeHandler,
  getCommitteeHandler,
  getGroupCommitteeStatus,
};
