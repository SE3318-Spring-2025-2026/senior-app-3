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

const advisorRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      default: () => `adv_req_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    professorId: {
      type: String,
      required: true,
    },
    requestedBy: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    notificationTriggered: {
      type: Boolean,
      default: false,
    },
    message: {
      type: String,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false, timestamps: true }
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
    advisorStatus: {
      type: String,
      enum: ['assigned', 'released', 'transferred', null],
      default: null,
    },
    advisorUpdatedAt: {
      type: Date,
      default: null,
    },
    /** Set when advisorId is assigned/changed; cleared when advisor is removed */
    advisorAssignedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending_validation', 'active', 'inactive', 'archived'],
      default: 'pending_validation',
    },
    members: [memberSchema],
    advisorRequest: advisorRequestSchema,
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
    jiraProjectId: {
      type: String,
      default: null,
    },
    jiraLastSynced: {
      type: Date,
      default: null,
    },
    jiraStoryPointOnly: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

groupSchema.index({ leaderId: 1 });
groupSchema.index({ status: 1 });
groupSchema.index({ 'advisorRequest.requestId': 1 });
groupSchema.index({ 'advisorRequest.professorId': 1 });
groupSchema.index({ 'advisorRequest.status': 1 });
groupSchema.index({ advisorId: 1 });
groupSchema.index({ advisorStatus: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;