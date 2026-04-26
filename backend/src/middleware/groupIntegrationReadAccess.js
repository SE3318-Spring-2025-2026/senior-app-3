'use strict';

const Group = require('../models/Group');
const { studentBelongsToGroup } = require('../utils/studentGroupMembership');

/**
 * Read-only integration status (GitHub/Jira): coordinators see any group;
 * students only groups they lead or are accepted members of.
 * Unknown groupId → 404 (matches getGroup / getGithub behaviour).
 */
async function coordinatorAdminOrGroupMember(req, res, next) {
  try {
    const { role, userId } = req.user || {};
    const { groupId } = req.params || {};
    if (!groupId) {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'groupId is required' });
    }

    const exists = await Group.exists({ groupId });
    if (!exists) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: `No group found with id "${groupId}".`,
      });
    }

    if (['coordinator', 'admin'].includes(role)) {
      return next();
    }
    if (role === 'student' && userId) {
      const ok = await studentBelongsToGroup(userId, groupId);
      if (ok) return next();
    }
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view integration status for this group',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { coordinatorAdminOrGroupMember };
