const Group = require('../models/Group');
const ApprovalQueue = require('../models/ApprovalQueue');
const GroupMembership = require('../models/GroupMembership');
const Override = require('../models/Override');
const User = require('../models/User');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('../services/auditService');
const { forwardToMemberRequestPipeline, forwardOverrideToReconciliation } = require('../services/groupService');

const VALID_DECISIONS = new Set(['approved', 'rejected']);

/**
 * POST /groups/:groupId/approval-results
 *
 * Forwards approval results from process 2.4 to the 2.5 processing queue
 * (DFD flow f09: 2.4 → 2.5). Approved decisions trigger D2 member record
 * updates. Duplicate forwarding of the same notification_id is idempotent.
 */
const forwardApprovalResults = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { notification_id, results } = req.body;

    if (!notification_id || typeof notification_id !== 'string' || !notification_id.trim()) {
      return res.status(400).json({
        code: 'MISSING_NOTIFICATION_ID',
        message: 'notification_id is required',
      });
    }

    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({
        code: 'EMPTY_RESULTS',
        message: 'results must be a non-empty array',
      });
    }

    // Validate each result entry
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.student_id || typeof r.student_id !== 'string') {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].student_id is required`,
        });
      }
      if (!r.decision || !VALID_DECISIONS.has(r.decision)) {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].decision must be 'approved' or 'rejected'`,
        });
      }
      if (!r.decided_by || typeof r.decided_by !== 'string') {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].decided_by is required`,
        });
      }
      if (!r.decided_at || isNaN(new Date(r.decided_at).getTime())) {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].decided_at must be a valid date`,
        });
      }
    }

    // Validate group exists
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const processedAt = new Date();
    const newlyQueued = [];

    for (const result of results) {
      const { student_id, decision, decided_by, decided_at } = result;

      // Idempotency check: skip if already forwarded for this (notification, group, student)
      const existing = await ApprovalQueue.findOne({
        notificationId: notification_id,
        groupId,
        studentId: student_id,
      });

      if (existing) {
        continue;
      }

      // Enqueue for process 2.5
      const queueEntry = await ApprovalQueue.create({
        groupId,
        notificationId: notification_id,
        studentId: student_id,
        decision,
        decidedBy: decided_by,
        decidedAt: new Date(decided_at),
        status: 'pending',
      });

      newlyQueued.push(queueEntry);

      // Process 2.5: update D2 member record for approved decisions
      if (decision === 'approved') {
        await GroupMembership.findOneAndUpdate(
          { groupId, studentId: student_id },
          {
            $set: {
              status: 'approved',
              decidedBy: decided_by,
              decidedAt: new Date(decided_at),
            },
            $setOnInsert: {
              membershipId: `mem_${require('uuid').v4().split('-')[0]}`,
            },
          },
          { upsert: true, new: true }
        );
      }

      // Mark queue entry as processed
      queueEntry.status = 'processed';
      queueEntry.processedAt = processedAt;
      await queueEntry.save();
    }

    return res.status(200).json({
      forwarded_count: newlyQueued.length,
      queued_request_ids: newlyQueued.map((q) => q.queueId),
      processed_at: processedAt.toISOString(),
    });
  } catch (err) {
    console.error('forwardApprovalResults error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

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
    const {
      groupName,
      leaderId,
      githubPat,
      githubOrg,
      jiraUrl,
      jiraUsername,
      jiraToken,
      projectKey,
    } = req.body;

    // --- Schedule boundary check (f01: Student → 2.1) ---
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    });

    if (!activeWindow) {
      return res.status(403).json({
        code: 'OUTSIDE_SCHEDULE_WINDOW',
        message: 'Group creation is currently closed. Please check the coordinator-defined schedule.',
      });
    }

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

    // --- One-active-group constraint: student may not lead or belong to another group ---
    const existingMembership = await GroupMembership.findOne({
      studentId: leader.userId,
      status: 'approved',
    });
    if (existingMembership) {
      return res.status(409).json({
        code: 'STUDENT_ALREADY_IN_GROUP',
        message: 'You already belong to an active group and cannot create another.',
      });
    }

    const existingLeadership = await Group.findOne({
      leaderId: leader.userId,
      status: { $nin: ['disbanded', 'rejected'] },
    });
    if (existingLeadership) {
      return res.status(409).json({
        code: 'STUDENT_ALREADY_LEADER',
        message: 'You are already the leader of an existing group.',
      });
    }

    // --- f18: Write validated group record to D2 with status pending_validation ---
    const group = new Group({
      groupName: normalizedName,
      leaderId: leader.userId,
      status: 'pending_validation',
      githubPat: githubPat || null,
      githubOrg: githubOrg || null,
      jiraUrl: jiraUrl || null,
      jiraUsername: jiraUsername || null,
      jiraToken: jiraToken || null,
      projectKey: projectKey || null,
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
  projectKey: group.projectKey,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

const VALID_OVERRIDE_ACTIONS = new Set(['add_member', 'remove_member', 'update_group']);

const VALID_GROUP_FIELDS = new Set([
  'groupName', 'leaderId', 'advisor', 'status',
  'githubOrg', 'githubPat', 'jiraProject', 'jiraUrl',
  'jiraUsername', 'jiraToken', 'projectKey',
]);

const VALID_GROUP_STATUSES = new Set(['pending_validation', 'active', 'inactive', 'archived']);

/**
 * PATCH /groups/:groupId/override
 *
 * Process 2.8 — Coordinator Override: forcibly add or remove a student from a group,
 * bypassing the standard invitation/approval flow.
 *
 * DFD flows:
 *   f16 — Coordinator → 2.8 (override request received)
 *   f21 — 2.8 → D2  (member records updated immediately)
 *   f17 — 2.8 → 2.5 (override confirmation forwarded for reconciliation)
 *
 * Role guard: coordinator only (403 for all other roles).
 * Not restricted by coordinator-defined schedule windows.
 */
const coordinatorOverride = async (req, res) => {
  try {
    // --- Role validation: Only coordinators can perform overrides ---
    if (req.user.role !== 'coordinator') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This action requires coordinator role',
      });
    }

    const { groupId } = req.params;
    const { action, target_student_id, updates, reason } = req.body;

    if (!action || !VALID_OVERRIDE_ACTIONS.has(action)) {
      return res.status(400).json({
        code: 'INVALID_ACTION',
        message: "action must be 'add_member', 'remove_member', or 'update_group'",
      });
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({
        code: 'MISSING_REASON',
        message: 'reason is required',
      });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const timestamp = new Date();

    if (action === 'update_group') {
      // Validate updates payload
      if (
        !updates ||
        typeof updates !== 'object' ||
        Array.isArray(updates) ||
        Object.keys(updates).length === 0
      ) {
        return res.status(400).json({
          code: 'MISSING_UPDATES',
          message: 'updates must be a non-empty object',
        });
      }

      const unknownFields = Object.keys(updates).filter((k) => !VALID_GROUP_FIELDS.has(k));
      if (unknownFields.length > 0) {
        return res.status(400).json({
          code: 'UNKNOWN_FIELDS',
          message: `Unknown field(s): ${unknownFields.join(', ')}`,
        });
      }

      if (updates.status !== undefined && !VALID_GROUP_STATUSES.has(updates.status)) {
        return res.status(400).json({
          code: 'INVALID_STATUS',
          message: `status must be one of: ${[...VALID_GROUP_STATUSES].join(', ')}`,
        });
      }

      // f21: Apply partial update to D2 group record
      Object.assign(group, updates);
      await group.save();

      const override = await Override.create({
        groupId,
        action,
        updates,
        reason: reason.trim(),
        coordinatorId: req.user.userId,
        status: 'applied',
      });

      await forwardOverrideToReconciliation(override);

      try {
        await createAuditLog({
          action: 'COORDINATOR_OVERRIDE',
          actorId: req.user.userId,
          targetId: groupId,
          changes: { action, updates, reason: reason.trim() },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }

      return res.status(200).json({
        override_id: override.overrideId,
        action: override.action,
        status: 'applied',
        confirmation: `Group ${groupId} fields updated by coordinator override`,
        timestamp: override.createdAt.toISOString(),
      });
    }

    // add_member / remove_member
    if (!target_student_id || typeof target_student_id !== 'string' || !target_student_id.trim()) {
      return res.status(400).json({
        code: 'MISSING_TARGET_STUDENT',
        message: 'target_student_id is required',
      });
    }

    const targetStudent = await User.findOne({ userId: target_student_id.trim() });
    if (!targetStudent) {
      return res.status(404).json({
        code: 'STUDENT_NOT_FOUND',
        message: 'Target student not found',
      });
    }

    const studentId = target_student_id.trim();

    // f21: Update D2 member records immediately
    if (action === 'add_member') {
      const alreadyMember = group.members.some((m) => m.userId === studentId && m.status === 'accepted');
      if (!alreadyMember) {
        group.members = group.members.filter((m) => m.userId !== studentId);
        group.members.push({
          userId: studentId,
          role: 'member',
          status: 'accepted',
          joinedAt: timestamp,
        });
        await group.save();
      }

      await GroupMembership.findOneAndUpdate(
        { groupId, studentId },
        {
          $set: {
            status: 'approved',
            decidedBy: req.user.userId,
            decidedAt: timestamp,
          },
          $setOnInsert: {
            membershipId: `mem_${require('uuid').v4().split('-')[0]}`,
          },
        },
        { upsert: true, new: true }
      );
    } else {
      // remove_member
      group.members = group.members.filter((m) => m.userId !== studentId);
      await group.save();

      await GroupMembership.findOneAndUpdate(
        { groupId, studentId },
        {
          $set: {
            status: 'rejected',
            decidedBy: req.user.userId,
            decidedAt: timestamp,
          },
        }
      );
    }

    const override = await Override.create({
      groupId,
      action,
      targetStudentId: studentId,
      reason: reason.trim(),
      coordinatorId: req.user.userId,
      status: 'applied',
    });

    await forwardOverrideToReconciliation(override);

    try {
      await createAuditLog({
        action: 'COORDINATOR_OVERRIDE',
        actorId: req.user.userId,
        targetId: groupId,
        changes: { action, targetStudentId: studentId, reason: reason.trim() },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      override_id: override.overrideId,
      action: override.action,
      status: 'applied',
      confirmation: `${action === 'add_member' ? 'Student added to' : 'Student removed from'} group ${groupId} by coordinator override`,
      timestamp: override.createdAt.toISOString(),
    });
  } catch (err) {
    console.error('coordinatorOverride error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { forwardApprovalResults, createGroup, getGroup, coordinatorOverride };
