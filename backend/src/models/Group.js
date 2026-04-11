const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const memberSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    role: { type: String, enum: ['leader', 'member'], default: 'member' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    joinedAt: { type: Date, default: null },
  },
  { _id: false }
);

const groupSchema = new mongoose.Schema(
  {
    groupId: {
      type: String,
      default: () => `grp_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    leaderId: {
      type: String,
      required: true,
    },
    advisorId: {
      type: String,
      default: null,
    },
    /** Assigned professor userId (D2 advisor association; Issue #75) */
    professorId: {
      type: String,
      default: null,
    },
    /** Advisor workflow state distinct from group lifecycle `status` */
    advisorStatus: {
      type: String,
      enum: ['pending', 'assigned', 'none', 'released', 'transferred'],
      default: 'pending',
    },
    advisorUpdatedAt: {
      type: Date,
      default: null,
    },
    advisorAssignedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending_validation', 'active', 'inactive', 'archived', 'rejected'],
      default: 'pending_validation',
    },
    members: [memberSchema],
    githubOrg: {
      type: String,
      default: null,
    },
    githubOrgId: {
      type: Number,
      default: null,
    },
    githubOrgName: {
      type: String,
      default: null,
    },
    githubRepoName: {
      type: String,
      default: null,
    },
    githubRepoUrl: {
      type: String,
      default: null,
    },
    githubVisibility: {
      type: String,
      enum: ['private', 'public', 'internal'],
      default: 'private',
    },
    githubPat: {
      type: String,
      default: null,
    },
    githubLastSynced: {
      type: Date,
      default: null,
    },
    jiraProject: {
      type: String,
      default: null,
    },
    jiraUrl: {
      type: String,
      default: null,
    },
    jiraBoardUrl: {
      type: String,
      default: null,
    },
    jiraUsername: {
      type: String,
      default: null,
    },
    jiraToken: {
      type: String,
      default: null,
    },
    projectKey: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

groupSchema.index({ leaderId: 1 });
groupSchema.index({ status: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
