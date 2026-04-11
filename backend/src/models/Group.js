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
 * * FIX #3: UNIQUE INDEX CORRECTION
 * DEFICIENCY: unique: true on embedded subdocument field is meaningless.
 * PROBLEM: Mongoose does not create global uniqueness for fields within embedded documents.
 * SOLUTION: Removed unique: true here. Uniqueness is enforced by sparse unique index on parent schema.
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
    },
    // FIX #2: DISBAND STATE CONSOLIDATION
    // SOLUTION: Added 'disbanded' to advisorStatus for specific lifecycle tracking.
    // Group overall status remains 'archived' when disbanded.
    advisorStatus: {
      type: String,
      enum: ['pending', 'assigned', 'released', 'transferred', 'disbanded', null],
      default: null,
    },
    advisorRequestId: {
      type: String,
      default: null,
    },
    advisorRequest: advisorRequestSchema,
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
groupSchema.index({ advisorId: 1 });
groupSchema.index({ advisorStatus: 1 });
groupSchema.index({ groupId: 1 }, { unique: true });

/**
 * FIX #3 ADDITION: Enforce global uniqueness on advisor request ID.
 * Sparse index allows groups without an active request to exist.
 */
groupSchema.index({ 'advisorRequest.requestId': 1 }, { unique: true, sparse: true });

/**
 * FIX #5: INDEX DRIFT RESOLUTION
 * Matches migration 006. Single source of truth for multi-field advisor queries.
 */
groupSchema.index({ advisorId: 1, advisorStatus: 1 });

// Optimization for advisor request tracking
groupSchema.index({ 'advisorRequest.professorId': 1 });
groupSchema.index({ 'advisorRequest.status': 1 });

// feature/67: Optimized for scanning unassigned groups during sanitization
groupSchema.index({ status: 1, advisorId: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;