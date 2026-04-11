const mongoose = require('mongoose');

/**
 * Issue #61: AdvisorRequest Model (D2 Extension)
 * 
 * Data Store: D2 - Advisory Assignment Tracking
 * 
 * Purpose:
 * Stores advisor request records for Process 3.0-3.7 workflow.
 * Tracks all advisor association requests and their lifecycle.
 * 
 * Used by Processes:
 * - Process 3.2: Request validation & storage (flow f03: 3.2 → D2)
 * - Process 3.3: Notification dispatch tracking
 * - Process 3.4: Advisor decision (approve/reject)
 * - Process 3.5: Assignment update
 * - Process 3.7: Disband notification
 * 
 * DFD Flows:
 * - f03: 3.2 → D2 (write advisor request)
 * - f08: 3.5 → D2 (write assignment update)
 * - f12: D2 → 3.7 (read for sanitization)
 * - f13: 3.7 → D2 (write disband update)
 */
const advisorRequestSchema = new mongoose.Schema(
  {
    /**
     * Issue #61 Fix #1: Unique request identifier
     * Format: ADVREQ_${timestamp}_${random}
     * Generated on creation
     * Used throughout Process 3.0-3.7 for tracking
     */
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    /**
     * Issue #61: Link to Group (D2 reference)
     * Used to find requests for a specific group
     * Query pattern: AdvisorRequest.find({groupId})
     */
    groupId: {
      type: String,
      required: true,
      index: true,
    },

    /**
     * Issue #61: Link to Professor (D1 reference)
     * User ID of the professor being requested as advisor
     * Validated against D1 User Accounts in Process 3.2
     */
    professorId: {
      type: String,
      required: true,
    },

    /**
     * Issue #61: Link to Requester (Team Leader ID)
     * User ID of the student/team leader who submitted the request
     * Used for audit trail and authorization checks
     */
    requesterId: {
      type: String,
      required: true,
    },

    /**
     * Issue #61: Request message
     * Optional message from team leader to professor
     * Included in notification payload (flow f05)
     */
    message: {
      type: String,
      default: '',
    },

    /**
     * Issue #61 Fix #5: Request status with Unique Partial Index
     * 
     * Lifecycle:
     * - pending: Initial state (3.2 creates)
     * - approved: Professor approved (3.4 decides)
     * - rejected: Professor rejected (3.4 decides)
     * 
     * PR Review Issue #5: Race Condition Protection
     * Unique partial index on (groupId, status: 'pending'):
     * - Prevents concurrent duplicate pending requests
     * - Database enforces atomically (E11000 error)
     * - No race condition between check and insert
     * 
     * Implementation details below in index definitions
     */
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    /**
     * Issue #61: Notification dispatch tracking
     * - true: Successfully dispatched to Notification Service
     * - false: Notification dispatch failed or not attempted
     * 
     * Used by coordinator to verify notification delivery
     */
    notificationTriggered: {
      type: Boolean,
      default: false,
    },

    /**
     * Issue #61: Decision (if approved/rejected)
     * Enum: 'approved' | 'rejected'
     * Set by Process 3.4 when professor decides
     */
    decision: {
      type: String,
      enum: ['approved', 'rejected'],
      default: null,
    },

    /**
     * Issue #61: Rejection reason (if rejected)
     * Optional message from professor explaining rejection
     * Included in rejection notice (flow f05 variant)
     */
    rejectionReason: {
      type: String,
      default: '',
    },

    /**
     * Issue #61: Decision timestamp
     * When professor made the decision
     * Used for audit trail
     */
    decidedAt: Date,

    /**
     * Issue #61: ID of professor who decided
     * For audit trail (should match professorId for consistency)
     */
    decidedBy: String,
  },
  {
    timestamps: true,
  }
);

/**
 * Issue #61 Fix #5: Unique Partial Index for Duplicate Prevention
 * 
 * Index Strategy:
 * - { groupId: 1, status: 1 } UNIQUE with partial filter
 * - Partial filter: { status: 'pending' }
 * - Effect: Only ONE pending request per group allowed
 * - Other statuses (approved/rejected) don't conflict
 * 
 * Why partial index?
 * - Groups can have multiple historical requests (approved + rejected)
 * - But only ONE pending request at a time
 * - Saves index space (doesn't index approved/rejected)
 * 
 * Race Condition Handling:
 * - Thread A: checks pending requests → finds none
 * - Thread B: checks pending requests → finds none
 * - Thread A: inserts → succeeds
 * - Thread B: inserts → fails with E11000 error
 * - Our code catches E11000 and returns 409 Conflict
 * 
 * Atomic Guarantee:
 * - No gap between check and insert
 * - Database enforces uniqueness constraint
 * - No application-level race condition possible
 */
advisorRequestSchema.index(
  { groupId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'groupId_pending_status_unique',
  }
);

/**
 * Issue #61 Fix #6: Additional Indexes for Query Optimization
 * 
 * Index 2: professorId lookup
 * - Query: AdvisorRequest.find({professorId: '...'})
 * - Used in: Process 3.3 (find all pending requests for a professor)
 */
advisorRequestSchema.index({ professorId: 1 });

/**
 * Index 3: Status + CreatedAt (descending)
 * - Query: AdvisorRequest.find({status: 'pending'}).sort({createdAt: -1})
 * - Used in: Process 3.3 (find newest pending requests)
 */
advisorRequestSchema.index({ status: 1, createdAt: -1 });

/**
 * Index 4: Group + Status for bulk operations
 * - Query: AdvisorRequest.find({groupId: '...', status: 'pending'})
 * - Used in: Process 3.7 (check if group has pending request during sanitization)
 */
advisorRequestSchema.index({ groupId: 1, status: 1 });

module.exports = mongoose.model('AdvisorRequest', advisorRequestSchema);
