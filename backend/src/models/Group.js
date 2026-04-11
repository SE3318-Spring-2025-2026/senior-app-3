const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// FIX #3: UNIQUE INDEX CORRECTION
// DEFICIENCY: unique: true on embedded subdocument field is meaningless
// PROBLEM: Mongoose does not create global uniqueness for fields within embedded documents
//          This creates false sense of constraint protection; duplicates can exist
// SOLUTION: Remove unique: true from subdocument, add sparse unique compound index to parent schema
//           This ensures true global uniqueness while allowing null values
const advisorRequestSchema = new mongoose.Schema(
  {
    // FIX #3 CHANGE: Removed unique: true from requestId
    // Uniqueness will be enforced by sparse compound index on parent schema instead
    requestId: { type: String, required: true },
    groupId: { type: String, required: true },
    professorId: { type: String, required: true },
    requesterId: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    message: { type: String, default: null },
    notificationTriggered: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

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
    },    // FIX #2: DISBAND STATE CONSOLIDATION
    // DEFICIENCY: Two conflicting sources of disband state (advisorStatus vs status enum)
    // PROBLEM: advisorStatus has 'disbanded' but status enum uses 'archived' for inactive groups
    //          This creates ambiguity in state machine (which field represents group lifecycle?)
    // SOLUTION: Add 'disbanded' to advisorStatus enum for advisor-specific lifecycle tracking
    //           Keep 'archived' in status enum for overall group lifecycle
    //           disbandGroup() transition: advisorStatus='disbanded' + status='archived'
    advisorStatus: {
      type: String,
      enum: ['pending', 'assigned', 'released', 'transferred', 'disbanded'],
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
  },
  { timestamps: true }
);

groupSchema.index({ leaderId: 1 });
groupSchema.index({ status: 1 });
groupSchema.index({ advisorId: 1 });
groupSchema.index({ advisorStatus: 1 });
groupSchema.index({ groupId: 1 }, { unique: true });

// FIX #3 ADDITION: Enforce global uniqueness on advisor request ID
// SOLUTION: Sparse unique compound index allows null values (no active request)
//           This is the correct way to enforce uniqueness in Mongoose
groupSchema.index({ 'advisorRequest.requestId': 1 }, { unique: true, sparse: true });

// FIX #5: INDEX DRIFT RESOLUTION
// DEFICIENCY: Compound index exists in migration but not in model schema
// PROBLEM: Index created in migration (006) is not reflected in model schema,
//          causing dev/prod mismatch and confusion about which indices are active
// SOLUTION: Add compound index definition to model schema as single source of truth
//           Query optimizer now clearly understands multi-field queries (advisorId + advisorStatus)
groupSchema.index({ advisorId: 1, advisorStatus: 1 });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
