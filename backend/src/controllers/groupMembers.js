const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const MemberInvitation = require('../models/MemberInvitation');
const User = require('../models/User');
const { dispatchInvitationNotification } = require('../services/notificationService');
const SyncErrorLog = require('../models/SyncErrorLog');

const VALID_DECISIONS = new Set(['accepted', 'rejected']);
const MAX_RETRY_ATTEMPTS = 3;

/**
 * POST /groups/:groupId/members
 *
 * Process 2.3 — Team leader invites one or more students to the group.
 *
 * DFD flows:
 *   f05 — Student (leader) → 2.3 (add member request)
 *   f06 — 2.3 → 2.4 (forward invitee IDs + group ID for notification dispatch)
 *   f19 — 2.3 → D2 (write pending member record)
 *   f32 — D2 → 2.3 (read current group data before processing)
 *
 * Business rule: a student may only belong to one active group at a time.
 * Per-student errors are collected and returned alongside successes so that
 * a batch request with mixed validity still adds the valid students.
 */
const addMember = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { student_ids } = req.body;

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ code: 'MISSING_STUDENT_IDS', message: 'student_ids must be a non-empty array' });
    }

    // f32: read current group data from D2
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== req.user.userId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the group leader can invite members' });
    }

    const added = [];
    const errors = [];

    for (const rawId of student_ids) {
      const inviteeId = typeof rawId === 'string' ? rawId.trim() : '';

      if (!inviteeId) {
        errors.push({ student_id: rawId, code: 'INVALID_STUDENT_ID', message: 'Student ID must be a non-empty string' });
        continue;
      }

      // Accept either userId or email address
      const invitee = await User.findOne({
        $or: [{ userId: inviteeId }, { email: inviteeId.toLowerCase() }],
      });
      if (!invitee) {
        errors.push({ student_id: inviteeId, code: 'STUDENT_NOT_FOUND', message: 'Student not found' });
        continue;
      }

      const existingApproved = await GroupMembership.findOne({
        studentId: inviteeId,
        status: 'approved',
        groupId: { $ne: groupId },
      });
      if (existingApproved) {
        errors.push({ student_id: inviteeId, code: 'STUDENT_ALREADY_IN_GROUP', message: 'Student already belongs to an active group' });
        continue;
      }

      const existing = await MemberInvitation.findOne({ groupId, inviteeId });
      if (existing) {
        errors.push({ student_id: inviteeId, code: 'ALREADY_INVITED', message: 'Student has already been invited to this group' });
        continue;
      }

      // f19: write pending member record to D2
      const invitation = await MemberInvitation.create({
        groupId,
        inviteeId,
        invitedBy: req.user.userId,
      });

      await GroupMembership.create({
        groupId,
        studentId: inviteeId,
        status: 'pending',
      });

      // f06: forward to process 2.4 — dispatch invitation notification (non-fatal)
      let notificationId = null;
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        try {
          const notifResult = await dispatchInvitationNotification({
            groupId,
            groupName: group.groupName,
            inviteeId,
            invitedBy: req.user.userId,
          });
          notificationId = notifResult.notification_id || null;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (lastError) {
        await SyncErrorLog.create({
          service: 'notification',
          groupId,
          actorId: req.user.userId,
          attempts: MAX_RETRY_ATTEMPTS,
          lastError: lastError.message,
        });
      } else if (notificationId) {
        invitation.notifiedAt = new Date();
        invitation.notificationId = notificationId;
        await invitation.save();
      }

      added.push({
        invitation_id: invitation.invitationId,
        invitee_id: inviteeId,
        status: 'pending',
        notified: !!notificationId,
      });
    }

    return res.status(201).json({
      added,
      ...(errors.length > 0 && { errors }),
      group_id: groupId,
      total_members: group.members.length + added.length,
    });
  } catch (err) {
    console.error('addMember error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * GET /groups/:groupId/members
 *
 * Returns the current member list from D2 (Group.members embedded array).
 */
const getMembers = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    return res.status(200).json({
      group_id: groupId,
      members: group.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (err) {
    console.error('getMembers error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * POST /groups/:groupId/notifications
 *
 * Process 2.3 — Dispatch invitation notification to the invitee.
 *
 * DFD flow:
 *   f06 — 2.3 → Notification Service (send invitation to student)
 *
 * Calls the external Notification Service (mocked in tests).
 * On 3 consecutive failures, logs a SyncErrorLog entry and returns 503.
 */
const dispatchNotification = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { invitee_id } = req.body;

    if (!invitee_id || typeof invitee_id !== 'string' || !invitee_id.trim()) {
      return res.status(400).json({ code: 'MISSING_INVITEE_ID', message: 'invitee_id is required' });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    if (group.leaderId !== req.user.userId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the group leader can dispatch notifications' });
    }

    const invitation = await MemberInvitation.findOne({ groupId, inviteeId: invitee_id.trim() });
    if (!invitation) {
      return res.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'No pending invitation found for this student' });
    }

    // Retry up to MAX_RETRY_ATTEMPTS times
    let notifResult;
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        notifResult = await dispatchInvitationNotification({
          groupId,
          groupName: group.groupName,
          inviteeId: invitee_id.trim(),
          invitedBy: req.user.userId,
        });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) {
      await SyncErrorLog.create({
        service: 'notification',
        groupId,
        actorId: req.user.userId,
        attempts: MAX_RETRY_ATTEMPTS,
        lastError: lastError.message,
      });
      return res.status(503).json({
        code: 'NOTIFICATION_SERVICE_UNAVAILABLE',
        message: 'Notification service failed after maximum retry attempts',
      });
    }

    invitation.notifiedAt = new Date();
    invitation.notificationId = notifResult.notification_id || null;
    await invitation.save();

    return res.status(200).json({
      notification_id: invitation.notificationId,
      invitee_id: invitation.inviteeId,
      notified_at: invitation.notifiedAt,
    });
  } catch (err) {
    console.error('dispatchNotification error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

/**
 * POST /groups/:groupId/membership-decisions
 *
 * Process 2.4 — Invited student accepts or rejects the group invitation.
 *
 * DFD flows:
 *   f07 — Student (invitee) → 2.4 (membership decision)
 *   f08 — 2.4 validates decision and updates D2 records
 *
 * Business rule: if the student has already accepted another group invitation,
 * auto-deny this one to enforce the one-active-group constraint.
 */
const membershipDecision = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { decision } = req.body;

    if (!decision || !VALID_DECISIONS.has(decision)) {
      return res.status(400).json({
        code: 'INVALID_DECISION',
        message: "decision must be 'accepted' or 'rejected'",
      });
    }

    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ code: 'GROUP_NOT_FOUND', message: 'Group not found' });
    }

    const studentId = req.user.userId;

    const invitation = await MemberInvitation.findOne({ groupId, inviteeId: studentId });
    if (!invitation) {
      return res.status(404).json({ code: 'INVITATION_NOT_FOUND', message: 'No invitation found for this student' });
    }

    if (invitation.status !== 'pending') {
      return res.status(409).json({
        code: 'DECISION_ALREADY_MADE',
        message: `Invitation has already been ${invitation.status}`,
      });
    }

    // Auto-denial: one active group per student
    if (decision === 'accepted') {
      const existingApproved = await GroupMembership.findOne({
        studentId,
        status: 'approved',
        groupId: { $ne: groupId },
      });
      if (existingApproved) {
        // Auto-deny this invitation
        invitation.status = 'rejected';
        invitation.decidedAt = new Date();
        await invitation.save();
        await GroupMembership.findOneAndUpdate(
          { groupId, studentId },
          { $set: { status: 'rejected', decidedBy: studentId, decidedAt: new Date() } }
        );
        return res.status(409).json({
          code: 'STUDENT_ALREADY_IN_GROUP',
          message: 'Student already belongs to an active group. Invitation auto-denied.',
          auto_denied: true,
        });
      }
    }

    // f08: update D2 records
    const decidedAt = new Date();
    invitation.status = decision;
    invitation.decidedAt = decidedAt;
    await invitation.save();

    const membershipStatus = decision === 'accepted' ? 'approved' : 'rejected';
    await GroupMembership.findOneAndUpdate(
      { groupId, studentId },
      { $set: { status: membershipStatus, decidedBy: studentId, decidedAt } }
    );

    // If accepted, add to group.members embedded array
    if (decision === 'accepted') {
      const alreadyMember = group.members.some((m) => m.userId === studentId);
      if (!alreadyMember) {
        group.members.push({ userId: studentId, role: 'member', status: 'accepted', joinedAt: decidedAt });
        await group.save();
      }
    }

    return res.status(200).json({
      invitation_id: invitation.invitationId,
      group_id: groupId,
      student_id: studentId,
      decision,
      decided_at: decidedAt,
    });
  } catch (err) {
    console.error('membershipDecision error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
};

module.exports = { addMember, getMembers, dispatchNotification, membershipDecision };
