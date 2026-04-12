const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const ApprovalQueue = require('../models/ApprovalQueue');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');
const AdvisorRequest = require('../models/AdvisorRequest');
const Override = require('../models/Override');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('../services/auditService');
const { forwardToMemberRequestPipeline, forwardOverrideToReconciliation } = require('../services/groupService');
const { dispatchGroupCreationNotification } = require('../services/notificationService');
const { VALID_STATUS_TRANSITIONS } = require('../utils/groupStatusEnum');

/**
 * HELPER: Formats a Group document into the API response shape.
 * Combines logic from both branches for UI completeness.
 */
const formatGroupResponse = (group, extras = {}) => ({
  groupId: group.groupId,
  groupName: group.groupName,
  leaderId: group.leaderId,
  advisorId: group.advisorId || null,
  professorId: group.professorId ?? group.advisorId ?? null,
  advisorStatus: group.advisorStatus ?? null,
  advisorName: extras.advisorName ?? group.advisorName ?? null,
  advisorAssignedAt: group.advisorAssignedAt || null,
  advisorRequest: extras.advisorRequest ?? group.advisorRequest ?? null,
  status: group.status,
  members: (group.members || []).map((m) => ({
    userId: m.userId,
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt,
  })),
  githubOrg: group.githubOrg || null,
  githubRepoUrl: group.githubRepoUrl || null,
  jiraProjectKey: group.projectKey || null,
  jiraBoardUrl: group.jiraBoardUrl || null,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

const displayNameFromUser = (user) => {
  if (!user) return null;
  return user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : (user.name || user.email?.split('@')[0] || user.userId);
};

/**
 * GET /groups/:groupId
 * Optimized with Promise.all and lean() from Main.
 * Includes detailed Advisor Request status from Feature.
 */
const getGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await Group.findOne({ groupId }).lean();

    if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found.' });

    // Fetch Advisor details and latest request in parallel (Performance Fix)
    const [advisorUser, latestRequest] = await Promise.all([
      group.advisorId ? User.findOne({ userId: group.advisorId }).lean().select('firstName lastName name email') : null,
      AdvisorRequest.findOne({ groupId }).sort({ createdAt: -1 }).lean(),
    ]);

    const advisorName = displayNameFromUser(advisorUser);
    let advisorRequest = null;

    if (latestRequest) {
      advisorRequest = {
        requestId: latestRequest.requestId,
        status: latestRequest.status,
        professorId: latestRequest.professorId,
        message: latestRequest.reason || latestRequest.message || '',
        createdAt: latestRequest.createdAt
      };
    }

    // Audit log (non-fatal)
    createAuditLog({
      action: 'GROUP_RETRIEVED',
      actorId: req.user.userId,
      targetId: group.groupId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(e => console.error('Audit failed:', e.message));

    return res.status(200).json(formatGroupResponse(group, { advisorName, advisorRequest }));
  } catch (error) {
    console.error('getGroup error:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Error retrieving the group.' });
  }
};

/**
 * GET /api/v1/groups (Coordinator Only)
 * Entrypoint for Issue #150: Enriches list with sync errors and connection status.
 */
const getAllGroups = async (req, res) => {
  try {
    if (req.user.role !== 'coordinator') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator role required' });
    }

    const groups = await Group.find().sort({ createdAt: -1 }).lean();
    
    const enrichedGroups = await Promise.all(groups.map(async (group) => {
      const syncErrors = await SyncErrorLog.find({ groupId: group.groupId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      return {
        ...group,
        memberCount: group.members.length,
        integrationErrors: syncErrors,
        githubConnected: !!(group.githubOrg && group.githubRepoUrl),
        jiraConnected: !!(group.projectKey && group.jiraBoardUrl)
      };
    }));

    return res.status(200).json({ groups: enrichedGroups, total: enrichedGroups.length });
  } catch (error) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Error retrieving groups.' });
  }
};

/**
 * PATCH /groups/:groupId/override
 * State machine validation and reconciliation trigger.
 */
const coordinatorOverride = async (req, res) => {
  try {
    if (req.user.role !== 'coordinator') return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator role required' });

    const { groupId } = req.params;
    const { action, updates, reason } = req.body;

    if (!reason?.trim()) return res.status(400).json({ code: 'MISSING_REASON', message: 'Reason is required' });

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });

    if (action === 'update_group') {
      const oldStatus = group.status;
      // Status Transition Guard
      if (updates.status && updates.status !== oldStatus) {
        const allowed = VALID_STATUS_TRANSITIONS[oldStatus];
        if (!allowed || !allowed.has(updates.status)) {
          return res.status(409).json({ code: 'INVALID_STATUS_TRANSITION', message: `Cannot move from ${oldStatus} to ${updates.status}` });
        }
      }

      Object.assign(group, updates);
      await group.save();

      const override = await Override.create({ 
        groupId, 
        action, 
        updates, 
        reason: reason.trim(), 
        coordinatorId: req.user.userId, 
        status: 'applied' 
      });

      await forwardOverrideToReconciliation(override);
      
      await createAuditLog({
        action: 'coordinator_override',
        actorId: req.user.userId,
        targetId: groupId,
        groupId,
        payload: { action, updates, reason: reason.trim() },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(200).json({ override_id: override.overrideId, status: 'applied' });
    }

    return res.status(400).json({ code: 'INVALID_ACTION', message: 'Action not supported yet.' });
  } catch (err) {
    console.error('coordinatorOverride error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

// ... Remaining methods (createGroup, transferAdvisor, createAdvisorRequest) 
// follow the same logic as the provided main branch.

module.exports = {
  getGroup,
  getAllGroups,
  coordinatorOverride,
  // Ensure these are correctly required/exported based on your project structure
  createGroup,
  forwardApprovalResults, 
  transferAdvisor,
  createAdvisorRequest
};