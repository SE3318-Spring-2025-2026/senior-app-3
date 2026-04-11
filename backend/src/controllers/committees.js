const Committee = require('../models/Committee');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');

const formatCommitteeResponse = (committee) => ({
  committeeId: committee.committeeId,
  committeeName: committee.committeeName,
  description: committee.description || null,
  advisorIds: committee.advisorIds || [],
  juryIds: committee.juryIds || [],
  status: committee.status,
  createdAt: committee.createdAt ? committee.createdAt.toISOString() : null,
  updatedAt: committee.updatedAt ? committee.updatedAt.toISOString() : null,
  publishedAt: committee.publishedAt ? committee.publishedAt.toISOString() : null,
});

const getGroupCommitteeStatus = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await Group.findOne({ groupId });

    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Verify membership: user must be group member (approved status) or coordinator/admin
    const isCoordinator = ['coordinator', 'admin'].includes(req.user.role);
    if (!isCoordinator) {
      const membership = await GroupMembership.findOne({
        groupId,
        studentId: req.user.userId,
        status: 'approved',
      });
      if (!membership) {
        return res.status(403).json({
          code: 'FORBIDDEN',
          message: 'You do not have permission to view this group\'s committee status',
        });
      }
    }

    if (!group.committeeId) {
      return res.status(200).json({
        groupId,
        committeeId: null,
        committee: null,
      });
    }

    const committee = await Committee.findOne({ committeeId: group.committeeId });
    if (!committee) {
      return res.status(200).json({
        groupId,
        committeeId: group.committeeId,
        committee: null,
      });
    }

    return res.status(200).json({
      groupId,
      committeeId: committee.committeeId,
      committee: formatCommitteeResponse(committee),
    });
  } catch (error) {
    console.error('getGroupCommitteeStatus error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred while retrieving committee status.',
    });
  }
};

const getAssignedJuryCommittees = async (req, res) => {
  try {
    const userId = req.user.userId;
    const isCoordinator = ['coordinator', 'admin'].includes(req.user.role);
    const query = { juryIds: userId };
    if (!isCoordinator) {
      query.status = 'published';
    }
    const committees = await Committee.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      committees: committees.map(formatCommitteeResponse),
    });
  } catch (error) {
    console.error('getAssignedJuryCommittees error:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred while retrieving jury committees.',
    });
  }
};

module.exports = {
  getGroupCommitteeStatus,
  getAssignedJuryCommittees,
};
