const {
  createCommitteeDraft,
  publishCommitteeRecord,
  getCommitteeById,
} = require('../services/committeeStoreService');

const createCommittee = async (req, res) => {
  try {
    const { committeeName, description } = req.body;

    if (!committeeName || typeof committeeName !== 'string' || !committeeName.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'committeeName is required',
      });
    }

    const committee = await createCommitteeDraft({ committeeName, description });

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
  } catch (error) {
    if (error.code === 'COMMITTEE_NAME_EXISTS') {
      return res.status(409).json({
        code: error.code,
        message: error.message,
      });
    }

    console.error('createCommittee error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

const getCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const committee = await getCommitteeById(committeeId);
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: 'Committee not found',
      });
    }

    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      description: committee.description,
      advisorIds: committee.advisorIds,
      juryIds: committee.juryIds,
      status: committee.status,
      createdAt: committee.createdAt,
      updatedAt: committee.updatedAt,
      publishedAt: committee.publishedAt,
    });
  } catch (error) {
    console.error('getCommittee error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

const publishCommittee = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const committee = await publishCommitteeRecord(committeeId);

    return res.status(200).json({
      committeeId: committee.committeeId,
      committeeName: committee.committeeName,
      status: committee.status,
      publishedAt: committee.publishedAt,
      updatedAt: committee.updatedAt,
    });
  } catch (error) {
    if (error.code === 'COMMITTEE_NOT_FOUND') {
      return res.status(404).json({
        code: error.code,
        message: error.message,
      });
    }

    console.error('publishCommittee error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = {
  createCommittee,
  getCommittee,
  publishCommittee,
};
