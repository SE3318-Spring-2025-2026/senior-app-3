const Group = require('../models/Group');
const ApprovalQueue = require('../models/ApprovalQueue');
const GroupMembership = require('../models/GroupMembership');
const MemberInvitation = require('../models/MemberInvitation');
const Override = require('../models/Override');
const User = require('../models/User');
const { createAuditLog } = require('../services/auditService');
const { forwardToMemberRequestPipeline, forwardOverrideToReconciliation } = require('../services/groupService');
const { dispatchGroupCreationNotification } = require('../services/notificationService');
const { INACTIVE_GROUP_STATUSES, VALID_STATUS_TRANSITIONS } = require('../utils/groupStatusEnum');
const SyncErrorLog = require('../models/SyncErrorLog');

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

    // Issue #52: Check if leader already leads an active group (any status except rejected terminal state)
    const existingLeadership = await Group.findOne({
      leaderId: leader.userId,
      status: { $nin: ['rejected'] },
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

    // --- Dispatch group creation notification (non-fatal, 3-attempt retry) ---
    let notifLastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await dispatchGroupCreationNotification({
          groupId: group.groupId,
          groupName: group.groupName,
          leaderId: leader.userId,
        });
        notifLastError = null;
        break;
      } catch (err) {
        notifLastError = err;
      }
    }
    if (notifLastError) {
      try {
        const notifSyncErr = await SyncErrorLog.create({
          service: 'notification',
          groupId: group.groupId,
          actorId: leader.userId,
          attempts: 3,
          lastError: notifLastError.message,
        });
        await createAuditLog({
          action: 'sync_error',
          actorId: leader.userId,
          groupId: group.groupId,
          payload: {
            api_type: 'notification',
            retry_count: 3,
            last_error: notifLastError.message,
            sync_error_id: notifSyncErr.errorId,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (logErr) {
        console.error('SyncErrorLog/audit write failed (non-fatal):', logErr.message);
      }
    }

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: 'group_created',
        actorId: leader.userId,
        targetId: group.groupId,
        groupId: group.groupId,
        payload: {
          group_name: group.groupName,
          leader_id: leader.userId,
          status: group.status,
        },
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
  advisorId: group.advisorId,
  status: group.status,
  members: group.members.map((m) => ({
    userId: m.userId,
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt,
  })),
  githubOrg: group.githubOrg,
  githubRepoUrl: group.githubRepoUrl,
  jiraProjectKey: group.projectKey,
  jiraBoardUrl: group.jiraBoardUrl,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

const VALID_OVERRIDE_ACTIONS = new Set(['add_member', 'remove_member', 'update_group']);

const VALID_GROUP_FIELDS = new Set([
  'groupName', 'leaderId', 'advisorId', 'status',
  'githubOrg', 'githubRepoUrl', 'githubPat',
  'jiraProject', 'jiraUrl', 'jiraBoardUrl',
  'jiraUsername', 'jiraToken', 'projectKey',
]);

const VALID_GROUP_STATUSES = new Set(['pending_validation', 'active', 'inactive', 'rejected']);

// State machine: valid status transitions (Issue #52)
// VALID_STATUS_TRANSITIONS imported from groupStatusEnum for consistency

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

      // State machine validation: check if status transition is legal
      if (updates.status !== undefined && updates.status !== group.status) {
        const currentStatus = group.status;
        const nextStatus = updates.status;
        const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
        if (!allowedTransitions || !allowedTransitions.has(nextStatus)) {
          return res.status(409).json({
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot transition from '${currentStatus}' to '${nextStatus}'. Allowed transitions: ${[...allowedTransitions].join(', ') || 'none'}`,
            current_status: currentStatus,
            attempted_status: nextStatus,
            allowed_transitions: allowedTransitions ? [...allowedTransitions] : [],
          });
        }
      }

      // Capture old status for audit log
      const oldStatus = group.status;

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
          action: 'coordinator_override',
          actorId: req.user.userId,
          targetId: groupId,
          groupId,
          payload: {
            action,
            updates,
            reason: reason.trim(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed (non-fatal):', auditError.message);
      }

      // If status was updated, also log STATUS_TRANSITION (Issue #52: Use snake_case 'status_transition')
      if (updates.status !== undefined && updates.status !== oldStatus) {
        try {
          await createAuditLog({
            action: 'status_transition',
            actorId: req.user.userId,
            targetId: groupId,
            groupId,
            payload: {
              previous_status: oldStatus,
              new_status: updates.status,
              reason: reason.trim(),
              via: 'coordinator_override',
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          });
        } catch (auditError) {
          console.error('status_transition audit log failed (non-fatal):', auditError.message);
        }
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

      // Audit log: member_added via coordinator override
      try {
        await createAuditLog({
          action: 'member_added',
          actorId: req.user.userId,
          targetId: groupId,
          groupId,
          payload: {
            student_id: studentId,
            via: 'coordinator_override',
            reason: reason.trim(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('MEMBER_ADDED audit log failed (non-fatal):', auditError.message);
      }
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

      // Log member_removed action
      try {
        await createAuditLog({
          action: 'member_removed',
          actorId: req.user.userId,
          targetId: groupId,
          groupId,
          payload: {
            student_id: studentId,
            via: 'coordinator_override',
            reason: reason.trim(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('member_removed audit log failed (non-fatal):', auditError.message);
      }
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
        action: 'coordinator_override',
        actorId: req.user.userId,
        targetId: groupId,
        groupId,
        payload: {
          action,
          target_student_id: studentId,
          reason: reason.trim(),
        },
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

/**
 * POST /groups/:groupId/member-requests
 *
 * Student creates a member request to join a group.
 * The leader can then approve or reject the request.
 *
 * Returns 201 if request created successfully.
 * Returns 409 if duplicate request already exists.
 * Returns 404 if group not found.
 * Returns 400 if group is full or student already in group.
 */
const createMemberRequest = async (req, res) => {
  try {
    const { groupId } = req.params;
    const studentId = req.user.userId;

    // Find the group
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Issue #52: Check if group is inactive (cannot receive new members)
    if (INACTIVE_GROUP_STATUSES.has(group.status)) {
      return res.status(409).json({
        code: 'GROUP_INACTIVE',
        message: `Cannot request to join group with status '${group.status}'`,
        current_status: group.status,
      });
    }

    // Check if student already has a pending or approved membership in this group
    const existingMembership = await GroupMembership.findOne({
      groupId,
      studentId,
    });
    if (existingMembership && ['pending', 'approved'].includes(existingMembership.status)) {
      return res.status(409).json({
        code: 'DUPLICATE_REQUEST',
        message: 'You have already requested to join this group or are already a member',
      });
    }

    // Check if student is already in another active group
    const otherGroupMembership = await GroupMembership.findOne({
      groupId: { $ne: groupId },
      studentId,
      status: 'approved',
    });
    if (otherGroupMembership) {
      return res.status(400).json({
        code: 'ALREADY_IN_GROUP',
        message: 'You already belong to another active group',
      });
    }

    // Create the member request using MemberInvitation model
    const memberRequest = await MemberInvitation.create({
      groupId,
      inviteeId: studentId,
      invitedBy: 'self', // Student is requesting themselves
      status: 'pending',
    });

    // Create associated GroupMembership
    if (!existingMembership) {
      await GroupMembership.create({
        groupId,
        studentId,
        status: 'pending',
      });
    }

    // Audit log
    try {
      await createAuditLog({
        action: 'MEMBER_REQUESTED',
        actorId: studentId,
        targetId: groupId,
        details: {
          invitationId: memberRequest.invitationId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(201).json({
      request_id: memberRequest.invitationId,
      group_id: groupId,
      student_id: studentId,
      status: 'pending',
      created_at: memberRequest.createdAt.toISOString(),
    });
  } catch (err) {
    console.error('createMemberRequest error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

/**
 * PATCH /groups/:groupId/member-requests/:requestId
 *
 * Leader approves or rejects a member request.
 *
 * Returns 200 if decision recorded successfully.
 * Returns 404 if request not found.
 * Returns 403 if user is not the group leader.
 * Returns 400 if invalid decision.
 */
const decideMemberRequest = async (req, res) => {
  try {
    const { groupId, requestId } = req.params;
    const { decision } = req.body;

    // Validate decision
    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: 'decision must be "approved" or "rejected"',
      });
    }

    // Find the group
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Check if user is the group leader
    if (group.leaderId !== req.user.userId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only the group leader can decide on member requests',
      });
    }

    // Find the member request
    const memberRequest = await MemberInvitation.findOne({
      invitationId: requestId,
      groupId,
    });

    if (!memberRequest) {
      return res.status(404).json({
        code: 'REQUEST_NOT_FOUND',
        message: 'Member request not found',
      });
    }

    // Update the request status
    const timestamp = new Date();
    memberRequest.status = decision === 'approved' ? 'accepted' : 'rejected';
    memberRequest.decidedAt = timestamp;
    await memberRequest.save();

    // Update GroupMembership status
    await GroupMembership.findOneAndUpdate(
      {
        groupId,
        studentId: memberRequest.inviteeId,
      },
      {
        status: decision === 'approved' ? 'approved' : 'rejected',
        decidedAt: timestamp,
      }
    );

    // Audit log
    try {
      await createAuditLog({
        action: 'MEMBERSHIP_DECISION',
        actorId: req.user.userId,
        targetId: groupId,
        details: {
          studentId: memberRequest.inviteeId,
          decision: decision === 'approved' ? 'approved' : 'rejected',
          invitationId: requestId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      request_id: requestId,
      group_id: groupId,
      student_id: memberRequest.inviteeId,
      decision: decision === 'approved' ? 'approved' : 'rejected',
      decided_at: timestamp.toISOString(),
    });
  } catch (err) {
    console.error('decideMemberRequest error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { forwardApprovalResults, createGroup, getGroup, createMemberRequest, decideMemberRequest, coordinatorOverride };
