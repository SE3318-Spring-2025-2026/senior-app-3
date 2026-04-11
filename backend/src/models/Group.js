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
    status: {
      type: String,
      enum: ['pending_validation', 'active', 'inactive', 'archived'],
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
    /**
     * FIX #7 (Issue #81): Committee Assignment Referential Integrity
     * 
     * DEFICIENCY (from PR review):
     * Process 4.5 (Publish Committee) must update all associated groups with their
     * committee assignment. This is DFD flow f07: 4.5 → D2 (Groups).
     * Without these fields, groups remain orphaned with no linkage to their committee.
     * 
     * SOLUTION:
     * Added committeeId and committeePublishedAt to establish bidirectional relationship:
     * - committeeId: References the committee this group is assigned to
     * - committeePublishedAt: Timestamp when committee was published (audit trail)
     * 
     * IMPLEMENTATION:
     * When Process 4.5 publishes a committee, it calls Group.updateMany() to set these
     * fields for all assigned groups (see backend/src/services/committeePublishService.js FIX #6)
     * 
     * IMPACT:
     * ✅ Maintains referential integrity between D3 (Committee) and D2 (Groups)
     * ✅ Enables reverse lookup: find groups by committeeId
     * ✅ Provides audit trail via committeePublishedAt timestamp
     * ✅ Supports Process 4.5 requirement: "update related assignments (D2)"
     */
    committeeId: {
      type: String,
      default: null,
      index: true, // For fast group-by-committee queries
    },
    committeePublishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

groupSchema.index({ leaderId: 1 });
groupSchema.index({ status: 1 });

/**
 * FIX #7 (Issue #81): Additional index for committee-based lookups
 * 
 * Supports queries like: Group.find({ committeeId: 'COM-xxx' })
 * Used during Process 4.5 to find all groups assigned to a committee
 * for recipient aggregation in notification dispatch
 */
groupSchema.index({ committeeId: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
