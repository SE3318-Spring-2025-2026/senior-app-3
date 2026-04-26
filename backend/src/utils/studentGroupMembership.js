'use strict';

const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');

/** Group rows in these statuses still occupy the student's single-group slot. */
const OPEN_GROUP_STATUSES = ['active', 'pending_validation'];

/**
 * Whether the student is the leader or an accepted member of the given group.
 */
async function studentBelongsToGroup(userId, groupId) {
  if (!userId || !groupId) return false;
  const hit = await Group.findOne({
    groupId,
    $or: [
      { leaderId: userId },
      { members: { $elemMatch: { userId, status: 'accepted' } } },
    ],
  })
    .select('_id')
    .lean();
  return Boolean(hit);
}

/**
 * Pick one affiliated group for a student when multiple rows match.
 * Uses descending ObjectId order so the most recently created group wins.
 *
 * @param {string} userId
 * @param {{ statusIn?: string[] }|undefined} options  If statusIn is set, only those statuses qualify (e.g. login).
 * @returns {Promise<string|null>} groupId
 */
async function resolveStudentAffiliatedGroupId(userId, options = {}) {
  if (!userId) return null;
  const query = {
    $or: [
      { leaderId: userId },
      { members: { $elemMatch: { userId, status: 'accepted' } } },
    ],
  };
  const { statusIn } = options;
  if (Array.isArray(statusIn) && statusIn.length > 0) {
    query.status = { $in: statusIn };
  }

  const group = await Group.findOne(query).sort({ _id: -1 }).select('groupId').lean();
  return group?.groupId ?? null;
}

/**
 * Approved GroupMembership only counts if the linked group is still "open"
 * (active or pending_validation). Stale memberships on inactive/rejected/archived
 * groups must not block creating or joining another team.
 *
 * @param {string} studentId
 * @param {string} [excludeGroupId] - ignore membership in this group (e.g. target join)
 * @returns {Promise<{ groupId: string } | null>}
 */
async function findOpenApprovedGroupMembership(studentId, excludeGroupId) {
  if (!studentId) return null;
  const match = { studentId, status: 'approved' };
  if (excludeGroupId) {
    match.groupId = { $ne: excludeGroupId };
  }
  const groupColl = Group.collection.collectionName;
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: groupColl,
        localField: 'groupId',
        foreignField: 'groupId',
        as: 'grp',
      },
    },
    { $unwind: { path: '$grp', preserveNullAndEmptyArrays: false } },
    { $match: { 'grp.status': { $in: OPEN_GROUP_STATUSES } } },
    { $limit: 1 },
    { $project: { groupId: 1 } },
  ];
  const [row] = await GroupMembership.aggregate(pipeline);
  return row || null;
}

module.exports = {
  studentBelongsToGroup,
  resolveStudentAffiliatedGroupId,
  findOpenApprovedGroupMembership,
  OPEN_GROUP_STATUSES,
};
