const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Member Sub-schema (Process 2.3 - 2.5)
 */
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

/**
 * Advisor Request Sub-schema (Process 3.2)
 * FIX #3: Uniqueness is enforced by sparse unique index on parent schema.
 */
const advisorRequestSchema = new mongoose.Schema(
  {
    requestId: { 
      type: String, 
      required: true, 
      default: () => `adv_req_${uuidv4().split('-')[0]}`
    },
    professorId: { type: String, required: true },
    requestedBy: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    notificationTriggered: { type: Boolean, default: false },
    message: { type: String, default: null },
    approvedAt: { type: Date, default: null },
  },
  { _id: false, timestamps: true }
);

/**
 * Group Schema - Main Data Store (D2)
 */
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
      description: 'ID of the professor assigned as advisor (Process 3.5)',
    },
    // FIX #2: Combined 'disbanded' and null for lifecycle tracking (Issue #66)
    advisorStatus: {
      type: String,
      enum: ['pending', 'assigned', 'released', 'transferred', 'disbanded', null],
      default: null,
      description: 'Tracks the state of advisor assignment for this group (Level 2.3)',
    },
    advisorRequestId: {
      type: String,
      default: null,
      description: 'Reference to the AdvisorRequest record for audit trail',
    },
    advisorRequest: advisorRequestSchema,
    advisorUpdatedAt: {
      type: Date,
      default: null,
      description: 'Timestamp of last advisor assignment status change',
    },
    advisorAssignedAt: {
      type: Date,
      default: null
    },
    advisorStatus: {
      type: String,
      enum: ['assigned', 'released', 'transferred', null],
      default: null,
    },
    status: {
      type: String,
      enum: ['pending_validation', 'active', 'inactive', 'archived', 'rejected'],
      default: 'pending_validation',
    },
    members: [memberSchema],
    
    // --- GitHub Integration (Process 2.6) ---
    githubOrg: { type: String, default: null },
    githubOrgId: { type: Number, default: null },
    githubOrgName: { type: String, default: null },
    githubRepoName: { type: String, default: null },
    githubRepoUrl: { type: String, default: null },
    githubVisibility: { type: String, enum: ['private', 'public', 'internal'], default: 'private' },
    githubPat: { type: String, default: null },
    githubLastSynced: { type: Date, default: null },
    
    // --- JIRA Integration (Process 2.7) ---
    jiraProject: { type: String, default: null },
    jiraUrl: { type: String, default: null },
    jiraBoardUrl: { type: String, default: null },
    jiraUsername: { type: String, default: null },
    jiraToken: { type: String, default: null },
    projectKey: { type: String, default: null },
    jiraProjectId: { type: String, default: null },
    jiraLastSynced: { type: Date, default: null },
    jiraStoryPointOnly: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// --- Core Indexes ---
groupSchema.index({ leaderId: 1 });
groupSchema.index({ status: 1 });
groupSchema.index({ groupId: 1 }, { unique: true });

// FIX #3: Global uniqueness for requests without breaking groups without requests
groupSchema.index({ 'advisorRequest.requestId': 1 }, { unique: true, sparse: true });

// FIX #5: Index Drift Resolution - High-performance queries for Coordinator View
groupSchema.index({ advisorId: 1, advisorStatus: 1 });
groupSchema.index({ 'advisorRequest.professorId': 1 });
groupSchema.index({ 'advisorRequest.status': 1 });

// Optimization for scanning unassigned groups during sanitization (Process 3.7)
groupSchema.index({ status: 1, advisorId: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;