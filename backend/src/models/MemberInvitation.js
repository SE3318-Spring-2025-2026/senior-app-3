const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * MemberInvitation — D2 record for Process 2.3 (f05, f19)
 *
 * Tracks invitations sent by a group leader to a student.
 * One invitation per (group, invitee) pair — enforced by unique index.
 * Distinct from GroupMembership: this tracks the invitation lifecycle,
 * while GroupMembership tracks the final committee-approved membership.
 */
const memberInvitationSchema = new mongoose.Schema(
  {
    invitationId: {
      type: String,
      default: () => `inv_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: { type: String, required: true },
    inviteeId: { type: String, required: true },
    invitedBy: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    notifiedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    notificationId: { type: String, default: null },
    decisionMessage: { type: String, default: null },
  },
  { timestamps: true }
);

// One invitation record per student per group
memberInvitationSchema.index({ groupId: 1, inviteeId: 1 }, { unique: true });
memberInvitationSchema.index({ inviteeId: 1, status: 1 });

module.exports = mongoose.model('MemberInvitation', memberInvitationSchema);
