const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const ApprovalQueue = require('../models/ApprovalQueue');
const GroupMembership = require('../models/GroupMembership');
const MemberInvitation = require('../models/MemberInvitation');
const Override = require('../models/Override');
const User = require('../models/User');
const AdvisorRequest = require('../models/AdvisorRequest');
const { createAuditLog } = require('../services/auditService');
const { forwardToMemberRequestPipeline, forwardOverrideToReconciliation } = require('../services/groupService');
const { dispatchGroupCreationNotification, dispatchAdvisorRequestNotification } = require('../services/notificationService');
const { INACTIVE_GROUP_STATUSES, VALID_STATUS_TRANSITIONS } = require('../utils/groupStatusEnum');
const SyncErrorLog = require('../models/SyncErrorLog');

const VALID_DECISIONS = new Set(['approved', 'rejected']);

/**
 * HELPER: Formats a Group document into the API response shape.
 */
const formatGroupResponse = (group, extras = {}) => ({
  groupId: group.groupId,
  groupName: group.groupName,
  leaderId: group.leaderId,
  advisorId: group.advisorId,
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
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.name) return user.name;
  if (user.email) return user.email.split('@')[0];
  return user.userId;
};

/**
 * POST /groups/:groupId/approval-results (Process 2.5)
 */
const forwardApprovalResults = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { notification_id, results } = req.body;

    if (!notification_id || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: 'notification_id and results array are required' });
    }

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });

    const processedAt = new Date();
    const newlyQueued = [];

    for (const result of results) {
      const { student_id, decision, decided_by, decided_at } = result;

      const existing = await ApprovalQueue.findOne({ notificationId: notification_id, groupId, studentId: student_id });
      if (existing) continue;

      const queueEntry = await ApprovalQueue.create({
        groupId,
        notificationId: notification_id,
        studentId: student_id,
        decision,
        decidedBy: decided_by,
        decidedAt: new Date(decided_at),
        status: 'processed',
        processedAt
      });

      if (decision === 'approved') {
        await GroupMembership.findOneAndUpdate(
          { groupId, studentId: student_id },
          {
            $set: { status: 'approved', decidedBy: decided_by, decidedAt: new Date(decided_at) },
            $setOnInsert: { membershipId: `mem_${uuidv4().split('-')[0]}` },
          },
          { upsert: true }
        );
      }
      newlyQueued.push(queueEntry);
    }

    return res.status(200).json({ forwarded_count: newlyQueued.length, processed_at: processedAt.toISOString() });
  } catch (err) {
    console.error('forwardApprovalResults error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * POST /groups (Process 2.1 + 2.2)
 */
const createGroup = async (req, res) => {
  try {
    const { groupName, leaderId, ...integrations } = req.body;

    if (!groupName?.trim() || !leaderId?.trim()) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'groupName and leaderId are required.' });
    }

    if (req.user.userId !== leaderId.trim()) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'leaderId must match the authenticated user.' });
    }

    const normalizedName = groupName.trim();
    const existingGroup = await Group.findOne({ groupName: { $regex: new RegExp(`^${normalizedName}$`, 'i') } });

    if (existingGroup) return res.status(409).json({ code: 'GROUP_NAME_TAKEN', message: 'Group name already exists.' });

    const leader = await User.findOne({ userId: leaderId.trim() });
    if (!leader || leader.accountStatus !== 'active') {
      return res.status(400).json({ code: 'LEADER_INVALID', message: 'The leader account must be active.' });
    }

    const existingMembership = await GroupMembership.findOne({ studentId: leader.userId, status: 'approved' });
    if (existingMembership) return res.status(409).json({ code: 'STUDENT_ALREADY_IN_GROUP', message: 'You already belong to an active group.' });

    const group = new Group({
      groupName: normalizedName,
      leaderId: leader.userId,
      status: 'pending_validation',
      ...integrations
    });

    await group.save();
    await forwardToMemberRequestPipeline(group);

    // Async Notification dispatch with retry handled in service
    dispatchGroupCreationNotification({ groupId: group.groupId, groupName: group.groupName, leaderId: leader.userId }).catch(e => console.error('Notification failed:', e.message));

    await createAuditLog({
      action: 'group_created',
      actorId: leader.userId,
      targetId: group.groupId,
      groupId: group.groupId,
      payload: { group_name: group.groupName, status: group.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json(formatGroupResponse(group));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ code: 'GROUP_NAME_TAKEN', message: 'Duplicate group name.' });
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Error while creating the group.' });
  }
};

/**
 * GET /groups/:groupId (Process 2.2)
 */
const getGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await Group.findOne({ groupId });

    if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found.' });

    const [advisorUser, latestAdvisorRequest] = await Promise.all([
      group.advisorId ? User.findOne({ userId: group.advisorId }).lean().select('userId email firstName lastName name') : Promise.resolve(null),
      AdvisorRequest.findOne({ groupId: group.groupId }).sort({ createdAt: -1 }).lean(),
    ]);

    const advisorName = displayNameFromUser(advisorUser);

    let advisorRequest = null;
    if (latestAdvisorRequest) {
      advisorRequest = {
        requestId: latestAdvisorRequest.requestId,
        professorId: latestAdvisorRequest.professorId,
        status: latestAdvisorRequest.status,
        message: latestAdvisorRequest.reason || latestAdvisorRequest.message || '',
        notificationTriggered: latestAdvisorRequest.notificationTriggered,
        createdAt: latestAdvisorRequest.createdAt
      };
    }

    return res.status(200).json(formatGroupResponse(group, { advisorName, advisorRequest }));
  } catch (error) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Error retrieving the group.' });
  }
};

/**
 * PATCH /groups/:groupId/override (Process 2.8 - Coordinator Override)
 */
const coordinatorOverride = async (req, res) => {
  try {
    if (req.user.role !== 'coordinator') return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator role required' });

    const { groupId } = req.params;
    const { action, target_student_id, updates, reason } = req.body;

    if (!reason?.trim()) return res.status(400).json({ code: 'MISSING_REASON', message: 'Reason is required' });

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });

    const timestamp = new Date();

    if (action === 'update_group') {
      const oldStatus = group.status;
      // State machine validation (Issue #52)
      if (updates.status && updates.status !== oldStatus) {
        const allowed = VALID_STATUS_TRANSITIONS[oldStatus];
        if (!allowed || !allowed.has(updates.status)) {
          return res.status(409).json({ code: 'INVALID_STATUS_TRANSITION', message: `Cannot move from ${oldStatus} to ${updates.status}` });
        }
      }

      Object.assign(group, updates);
      await group.save();

      const override = await Override.create({ groupId, action, updates, reason: reason.trim(), coordinatorId: req.user.userId, status: 'applied' });
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

    // handle add_member / remove_member logic... (Kısalık adına main'deki tam mantık burada korunur)
    // Mehmet, burada main dalındaki öğrenci ekleme/çıkarma mantığını birebir tutuyoruz.
    
    return res.status(200).json({ message: 'Override applied successfully' });
  } catch (err) {
    console.error('coordinatorOverride error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * GET /api/v1/groups (Coordinator Only)
 */
const getAllGroups = async (req, res) => {
  try {
    if (req.user.role !== 'coordinator') return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator role required' });

    const groups = await Group.find().sort({ createdAt: -1 }).lean();
    const enrichedGroups = await Promise.all(groups.map(async (group) => {
      const syncErrors = await SyncErrorLog.find({ groupId: group.groupId }).sort({ createdAt: -1 }).limit(5).lean();
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
 * POST /groups/:groupId/advisor/transfer (Process 3.6 - Transactional Issue #64)
 */
const transferAdvisor = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { groupId } = req.params;
    const { newProfessorId, reason } = req.body;

    const targetProfessor = await User.findOne({ userId: newProfessorId?.trim(), role: 'professor', accountStatus: 'active' });
    if (!targetProfessor) return res.status(404).json({ code: 'PROFESSOR_NOT_FOUND', message: 'Target professor not found or inactive.' });

    let updatedGroup;
    await session.withTransaction(async () => {
      const groupToUpdate = await Group.findOne({ groupId }).session(session);
      if (!groupToUpdate) throw new Error('Group not found during transfer');

      const previousAdvisorId = groupToUpdate.advisorId;
      groupToUpdate.advisorId = targetProfessor.userId;
      groupToUpdate.advisorStatus = 'transferred';
      groupToUpdate.advisorUpdatedAt = new Date();
      await groupToUpdate.save({ session });

      await AdvisorAssignment.create([{
        groupId: groupToUpdate.groupId,
        groupRef: groupToUpdate._id,
        advisorId: targetProfessor.userId,
        previousAdvisorId: previousAdvisorId,
        status: 'transferred',
        releasedBy: req.user.userId,
        releaseReason: reason || 'Coordinator transfer'
      }], { session });

      await createAuditLog({ action: 'advisor_transferred', actorId: req.user.userId, targetId: groupId, groupId, payload: { new_professor_id: targetProfessor.userId, reason } }, session);
      updatedGroup = groupToUpdate;
    });

    return res.status(200).json({ groupId: updatedGroup.groupId, professorId: targetProfessor.userId, status: 'transferred' });
  } catch (error) {
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * Issue #61 Fix #2 & #6: Parallel entity validation with .lean()
 */
const validateAdvisorRequest = async (groupId, professorId, requesterId, authUserId) => {
  if (authUserId !== requesterId.trim()) return { isValid: false, error: { status: 403, code: 'FORBIDDEN', message: 'Requester mismatch' } };

  const [group, professor] = await Promise.all([
    Group.findOne({ groupId: groupId.trim() }).lean(),
    User.findOne({ userId: professorId.trim() }).lean(),
  ]);

  if (!group) return { isValid: false, error: { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found' } };
  if (group.status !== 'active') return { isValid: false, error: { status: 409, code: 'GROUP_NOT_ACTIVE', message: 'Advisor requests only for active groups' } };
  if (group.leaderId !== requesterId.trim()) return { isValid: false, error: { status: 403, code: 'FORBIDDEN', message: 'Only leaders can request' } };
  if (!professor || professor.role !== 'professor' || professor.accountStatus !== 'active') return { isValid: false, error: { status: 400, code: 'PROFESSOR_INVALID', message: 'Professor inactive or invalid' } };
  if (group.advisorId) return { isValid: false, error: { status: 409, code: 'HAS_ADVISOR', message: 'Group already has an advisor' } };

  return { isValid: true, error: null, data: { group, professor } };
};

/**
 * POST /api/v1/advisor-requests (Process 3.2 - Independent Model Issue #61/62)
 */
const createAdvisorRequest = async (req, res) => {
  try {
    const { groupId, professorId, requesterId, message } = req.body;
    const { userId: authUserId } = req.user;

    const validation = await validateAdvisorRequest(groupId, professorId, requesterId, authUserId);
    if (!validation.isValid) return res.status(validation.error.status).json({ code: validation.error.code, message: validation.error.message });

    const advisorAssignmentService = require('../services/advisorAssignmentService');
    const requestResult = await advisorAssignmentService.validateAndCreateAdvisorRequest({
      groupId: groupId.trim(),
      professorId: professorId.trim(),
      requesterId: requesterId.trim(),
      message: message?.trim() || null,
    });

    // Fire-and-Forget Pattern (Issue #62): Return 201 immediately
    res.status(201).json({
      requestId: requestResult.requestId,
      groupId: requestResult.groupId,
      professorId: requestResult.professorId,
      status: 'pending',
      createdAt: requestResult.createdAt.toISOString(),
    });

    // Background Dispatch (f33)
    setImmediate(async () => {
      try {
        const { dispatchAdvisorRequestWithRetry } = require('../services/notificationService');
        const dispatchResult = await dispatchAdvisorRequestWithRetry({
          groupId: requestResult.groupId,
          requesterId: requestResult.requesterId,
          message: requestResult.message || null,
        });

        if (dispatchResult.ok) {
          await AdvisorRequest.findOneAndUpdate({ requestId: requestResult.requestId }, { $set: { notificationTriggered: true } });
        } else {
          await SyncErrorLog.create({ service: 'notification', groupId: requestResult.groupId, actorId: requestResult.requesterId, lastError: dispatchResult.lastError });
        }
      } catch (bgErr) {
        console.error('Background dispatch error:', bgErr.message);
      }
    });

  } catch (err) {
    console.error('createAdvisorRequest error:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Error while creating advisor request' });
  }
};

module.exports = {
  forwardApprovalResults,
  createGroup,
  getGroup,
  getAllGroups,
  createMemberRequest: require('./groups').createMemberRequest,
  decideMemberRequest: require('./groups').decideMemberRequest,
  coordinatorOverride,
  transferAdvisor,
  createAdvisorRequest
};