const Group = require('../models/Group');
const ApprovalQueue = require('../models/ApprovalQueue');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('../services/auditService');
const { forwardToMemberRequestPipeline } = require('../services/groupService');
const { sendMembershipDecisionEmail } = require('../services/emailService');

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

/**
 * POST /groups/:groupId/member-requests
 * Process 2.5: Student submits a membership request for a group (Issue #34).
 *
 * DFD flows:
 *   f03 — valid group data already forwarded from 2.2; group must exist in D2
 *   f20 — reads current group members from D2 to detect duplicates
 *
 * Creates a GroupMembership record (D2) with status `pending` and adds the
 * student to Group.members so the group reflects the pending request.
 */
const createMemberRequest = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { student_id } = req.body;

    if (!student_id || typeof student_id !== 'string' || !student_id.trim()) {
      return res.status(400).json({
        code: 'MISSING_STUDENT_ID',
        message: 'student_id is required',
      });
    }

    const studentId = student_id.trim();

    // Only the student themselves may create their own request
    if (req.user.userId !== studentId) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You may only submit a membership request for yourself',
      });
    }

    // f20: Read current group state from D2
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Verify student exists and is active
    const student = await User.findOne({ userId: studentId });
    if (!student) {
      return res.status(404).json({
        code: 'STUDENT_NOT_FOUND',
        message: 'Student not found',
      });
    }
    if (student.accountStatus !== 'active') {
      return res.status(400).json({
        code: 'STUDENT_ACCOUNT_INACTIVE',
        message: 'Student account must be active to request group membership',
      });
    }

    // Check for existing membership record in D2 (GroupMembership collection)
    const existing = await GroupMembership.findOne({ groupId, studentId });
    if (existing) {
      return res.status(409).json({
        code: 'REQUEST_ALREADY_EXISTS',
        message: `A membership request for this student already exists with status: ${existing.status}`,
      });
    }

    // Create GroupMembership record in D2 with status `pending`
    const membership = await GroupMembership.create({ groupId, studentId });

    // Mirror the pending state in the embedded Group.members array (D2 denormalised copy)
    const alreadyInMembers = group.members.some((m) => m.userId === studentId);
    if (!alreadyInMembers) {
      group.members.push({
        userId: studentId,
        role: 'member',
        status: 'pending',
        joinedAt: null,
      });
      await group.save();
    }

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: 'MEMBER_REQUEST_CREATED',
        actorId: studentId,
        targetId: group.groupId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    return res.status(201).json({
      membershipId: membership.membershipId,
      groupId: membership.groupId,
      studentId: membership.studentId,
      status: membership.status,
      createdAt: membership.createdAt,
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
 * Process 2.5: Apply an approve/reject decision to a pending membership request.
 *
 * DFD flows:
 *   f09 — approval result from 2.4 (normal flow; decision required)
 *   f17 — override confirmation from 2.8 (is_override: true; skips re-approval gate)
 *   f04 — on approval, sends group-created confirmation to the Student
 *   f20 — reads group and membership records from D2
 *
 * Accepts:
 *   { decision: 'approved'|'rejected', decided_by: userId, is_override?: bool }
 */
const decideMemberRequest = async (req, res) => {
  try {
    const { groupId, requestId } = req.params;
    const { decision, decided_by, is_override } = req.body;

    if (!decision || !VALID_DECISIONS.has(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: "decision must be 'approved' or 'rejected'",
      });
    }

    if (!decided_by || typeof decided_by !== 'string' || !decided_by.trim()) {
      return res.status(400).json({
        code: 'MISSING_DECIDED_BY',
        message: 'decided_by is required',
      });
    }

    // f20: Read group and membership record from D2
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const membership = await GroupMembership.findOne({ membershipId: requestId, groupId });
    if (!membership) {
      return res.status(404).json({
        code: 'REQUEST_NOT_FOUND',
        message: 'Member request not found',
      });
    }

    if (membership.status !== 'pending') {
      return res.status(409).json({
        code: 'REQUEST_ALREADY_DECIDED',
        message: `Request has already been ${membership.status}`,
      });
    }

    const decidedAt = new Date();

    // Update GroupMembership record in D2 — pending → approved/rejected
    membership.status = decision;
    membership.decidedBy = decided_by.trim();
    membership.decidedAt = decidedAt;
    await membership.save();

    // Update Group.members embedded record in D2
    const memberEntry = group.members.find((m) => m.userId === membership.studentId);
    if (memberEntry) {
      memberEntry.status = decision === 'approved' ? 'accepted' : 'rejected';
      if (decision === 'approved') {
        memberEntry.joinedAt = decidedAt;
      }
    }
    await group.save();

    // Determine audit action — override confirmations (f17: 2.8 → 2.5) are logged separately
    const auditAction = is_override
      ? 'MEMBER_REQUEST_OVERRIDE'
      : decision === 'approved'
        ? 'MEMBER_REQUEST_APPROVED'
        : 'MEMBER_REQUEST_REJECTED';

    // Audit log (non-fatal)
    try {
      await createAuditLog({
        action: auditAction,
        actorId: decided_by.trim(),
        targetId: group.groupId,
        changes: { studentId: membership.studentId, decision, is_override: !!is_override },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed (non-fatal):', auditError.message);
    }

    // f04: Group created confirmation → Student (non-fatal email)
    // Look up student email to dispatch the confirmation
    try {
      const student = await User.findOne({ userId: membership.studentId });
      if (student?.email) {
        await sendMembershipDecisionEmail(student.email, group.groupName, decision, student.userId);
      }
    } catch (emailError) {
      console.error('Membership decision email failed (non-fatal):', emailError.message);
    }

    return res.status(200).json({
      membershipId: membership.membershipId,
      groupId: membership.groupId,
      studentId: membership.studentId,
      status: membership.status,
      decidedBy: membership.decidedBy,
      decidedAt: membership.decidedAt,
      is_override: !!is_override,
    });
  } catch (err) {
    console.error('decideMemberRequest error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { forwardApprovalResults, createGroup, getGroup, createMemberRequest, decideMemberRequest };
