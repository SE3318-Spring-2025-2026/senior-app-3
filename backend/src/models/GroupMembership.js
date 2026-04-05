const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const groupMembershipSchema = new mongoose.Schema(
  {
    membershipId: {
      type: String,
      default: () => `mem_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
    studentId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    decidedBy: {
      type: String,
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// A student can only have one membership record per group (D2 upsert target)
groupMembershipSchema.index({ groupId: 1, studentId: 1 }, { unique: true });
groupMembershipSchema.index({ groupId: 1, status: 1 });

const GroupMembership = mongoose.model('GroupMembership', groupMembershipSchema);

module.exports = GroupMembership;
