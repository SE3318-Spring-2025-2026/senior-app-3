const Group = require('../models/Group');
const User = require('../models/User');
const { createAuditLog } = require('../services/auditService');
const { forwardToMemberRequestPipeline } = require('../services/groupService');

/**
 * POST /groups
 * Process 2.1 + 2.2: Create group, validate data, persist to D2, forward to 2.5.
 *
 * DFD flows:
 *   f02 — 2.1 sends groupName + leaderId to 2.2 for validation
 *   f18 — 2.2 writes validated group record to D2
 *   f03 — 2.2 forwards valid group data to Process 2.5
 */
const createGroup = async (req, res) => {
  try {
    const { groupName, leaderId } = req.body;

    // --- Input validation ---
    if (!groupName || typeof groupName !== 'string' || !groupName.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'groupName is required and must be a non-empty string.',
      });
    }

    if (!leaderId || typeof leaderId !== 'string' || !leaderId.trim()) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'leaderId is required.',
      });
    }

    // The authenticated user must be the declared leader.
    if (req.user.userId !== leaderId.trim()) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'leaderId must match the authenticated user.',
      });
    }

    const normalizedName = groupName.trim();

    // --- Process 2.2: Validate group name uniqueness against D2 ---
    const existingGroup = await Group.findOne({
      groupName: { $regex: new RegExp(`^${normalizedName}$`, 'i') },
    });

    if (existingGroup) {
      return res.status(409).json({
        code: 'GROUP_NAME_TAKEN',
        message: `A group named "${normalizedName}" already exists. Please choose a different name.`,
      });
    }

    // --- Process 2.2: Verify leaderId exists in D1 (User Accounts) ---
    const leader = await User.findOne({ userId: leaderId.trim() });

    if (!leader) {
      return res.status(400).json({
        code: 'LEADER_NOT_FOUND',
        message: 'The specified leader does not exist in user accounts (D1).',
      });
    }

    if (leader.accountStatus !== 'active') {
      return res.status(400).json({
        code: 'LEADER_ACCOUNT_INACTIVE',
        message: 'The leader account must be active before creating a group.',
      });
    }

    // --- f18: Write validated group record to D2 with status pending_validation ---
    const group = new Group({
      groupName: normalizedName,
      leaderId: leader.userId,
      status: 'pending_validation',
    });

    await group.save();

    // --- f03: Forward valid group data to Process 2.5 (member request pipeline) ---
    await forwardToMemberRequestPipeline(group);

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: 'GROUP_CREATED',
        actorId: leader.userId,
        targetId: group.groupId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(201).json(formatGroupResponse(group));
  } catch (error) {
    console.error('createGroup error:', error);

    // Mongoose duplicate-key error (race condition on groupName unique index)
    if (error.code === 11000) {
      return res.status(409).json({
        code: 'GROUP_NAME_TAKEN',
        message: 'A group with that name already exists.',
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while creating the group.',
    });
  }
};

/**
 * GET /groups/:groupId
 * Process 2.2: Return validated group record from D2.
 *
 * Returns: group_id, group_name, leader, advisor, status, members,
 *          github_org, jira_project
 */
const getGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({ groupId });

    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: `No group found with id "${groupId}".`,
      });
    }

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: 'GROUP_RETRIEVED',
        actorId: req.user.userId,
        targetId: group.groupId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(200).json(formatGroupResponse(group));
  } catch (error) {
    console.error('getGroup error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred while retrieving the group.',
    });
  }
};

/**
 * Formats a Group document into the API response shape.
 * Field names follow the acceptance criteria:
 *   group_id, group_name, leader, advisor, status, members,
 *   github_org, jira_project
 */
const formatGroupResponse = (group) => ({
  groupId: group.groupId,
  groupName: group.groupName,
  leaderId: group.leaderId,
  advisor: group.advisor,
  status: group.status,
  members: group.members.map((m) => ({
    userId: m.userId,
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt,
  })),
  githubOrg: group.githubOrg,
  jiraProject: group.jiraProject,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

module.exports = { createGroup, getGroup };
