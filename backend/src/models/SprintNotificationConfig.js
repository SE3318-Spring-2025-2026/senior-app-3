/**
 * ================================================================================
 * ISSUE #238: Sprint Update Notifications — Configuration Model
 * ================================================================================
 *
 * Purpose:
 * Store per-sprint/per-group notification configuration for sprints. Controls
 * whether students receive individual contribution notifications and whether
 * coordinator receives summary reports after recomputation (Process 7.5).
 *
 * DFD Reference:
 * - Flow f7_p75_ext_notification: 7.5 → Notification Service (dispatches events)
 * - Flow f7_p75_ext_coordinator: 7.5 → Coordinator report path (summary delivery)
 *
 * Acceptance Criteria (#238):
 * ✓ When notifyStudents=true, each group member receives notification event
 * ✓ Coordinator receives summary notification or in-app report trigger
 * ✓ Failures logged with correlationId; retries exhausted produce alert log
 * ✓ No notification sent when sprint window closed (422 path)
 *
 * Design Pattern:
 * Extends existing SprintConfig model pattern from Process 5.x deliverables.
 * Follows D2 Group integration configuration approach: per-entity settings stored
 * in collection with idempotent key (sprintId, groupId).
 *
 * ================================================================================
 */

const mongoose = require('mongoose');

// ISSUE #238: Define notification recipient type enum
const RECIPIENT_TYPES = {
  STUDENTS: 'students',
  COORDINATOR: 'coordinator',
  ADVISORS: 'advisors',
  COMMITTEE: 'committee'
};

// ISSUE #238: Define notification delivery method enum
const DELIVERY_METHODS = {
  INTERNAL_APP: 'internal_app',  // In-app notification widget
  EMAIL: 'email',                // Email delivery
  WEBHOOK: 'webhook'             // External webhook push
};

// ISSUE #238: Define recipient configuration strategy
const RECIPIENT_STRATEGIES = {
  GROUP_COORDINATORS: 'group_coordinators',   // Only group's assigned coordinators
  GROUP_ADVISORS: 'group_advisors',           // Only group's assigned advisors
  COMMITTEE_MEMBERS: 'committee_members',     // Committee that evaluated group
  ALL_STAKEHOLDERS: 'all_stakeholders'        // All above combined
};

/**
 * ISSUE #238: SprintNotificationConfig Schema
 *
 * Purpose: Store configuration for how notifications are delivered for a sprint
 * in a specific group. Allows per-sprint customization (e.g., disable notifications
 * for certain sprints while keeping them enabled for others).
 *
 * Idempotent Key: (sprintId, groupId) ensures one configuration per sprint+group pair.
 */
const sprintNotificationConfigSchema = new mongoose.Schema({
  // ISSUE #238: Unique identifiers
  notificationConfigId: {
    type: String,
    required: true,
    unique: true,
    default: () => `snc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    description: 'Unique identifier for this configuration (snc_ prefix)'
  },

  // ISSUE #238: Idempotent key components
  sprintId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
    description: 'Reference to Sprint entity (from D8 or sprint metadata)'
  },

  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
    description: 'Reference to Group entity (from D2)'
  },

  // ISSUE #238: Unique composite index (sprintId, groupId) to prevent duplicate configs
  _uniqueKey: {
    type: String,
    unique: true,
    sparse: true,
    description: 'Composite key: sprintId#groupId for idempotent upsert pattern'
  },

  // ISSUE #238: Student notification configuration
  notifyStudents: {
    type: Boolean,
    default: true,
    description: 'When true, send individual contribution notification to each student with ratio/completed SP'
  },

  studentDeliveryMethod: {
    type: String,
    enum: Object.values(DELIVERY_METHODS),
    default: DELIVERY_METHODS.INTERNAL_APP,
    description: 'How to deliver student notifications (internal_app, email, webhook)'
  },

  studentNotificationTemplate: {
    type: String,
    default: 'default_student_contribution_summary',
    description: 'Template name for student notifications (e.g., "default_student_contribution_summary", "detailed_breakdown")'
  },

  // ISSUE #238: Coordinator summary notification configuration
  notifyCoordinator: {
    type: Boolean,
    default: true,
    description: 'When true, send summary notification to coordinator(s) after recomputation'
  },

  coordinatorDeliveryMethod: {
    type: String,
    enum: Object.values(DELIVERY_METHODS),
    default: DELIVERY_METHODS.INTERNAL_APP,
    description: 'How to deliver coordinator notifications'
  },

  coordinatorRecipientStrategy: {
    type: String,
    enum: Object.values(RECIPIENT_STRATEGIES),
    default: RECIPIENT_STRATEGIES.GROUP_COORDINATORS,
    description: 'Which stakeholders receive coordinator summary (group_coordinators, all_stakeholders, etc)'
  },

  coordinatorNotificationTemplate: {
    type: String,
    default: 'default_coordinator_sprint_summary',
    description: 'Template name for coordinator notifications'
  },

  // ISSUE #238: Include mapping warnings in summary
  includeMappingWarnings: {
    type: Boolean,
    default: true,
    description: 'Include unmapped story points and attribution issues in coordinator summary'
  },

  // ISSUE #238: Feature flag and enable/disable
  enabled: {
    type: Boolean,
    default: true,
    description: 'Master enable/disable for all notifications for this sprint'
  },

  // ISSUE #238: Retry and resilience configuration
  maxRetryAttempts: {
    type: Number,
    default: 3,
    min: 1,
    max: 5,
    description: 'Maximum retry attempts for transient notification failures'
  },

  retryBackoffMs: {
    type: [Number],
    default: [100, 200, 400],
    description: 'Backoff delays in milliseconds for exponential backoff [1st, 2nd, 3rd] attempts'
  },

  // ISSUE #238: Tracking and audit
  createdBy: {
    type: String,
    description: 'Coordinator ID or system that created this configuration'
  },

  createdAt: {
    type: Date,
    default: Date.now,
    description: 'Configuration creation timestamp'
  },

  updatedBy: {
    type: String,
    description: 'Last coordinator ID or system that modified this configuration'
  },

  updatedAt: {
    type: Date,
    default: Date.now,
    description: 'Configuration last modification timestamp'
  },

  // ISSUE #238: Operational metadata
  lastNotificationAt: {
    type: Date,
    description: 'When notifications were last dispatched for this sprint'
  },

  lastNotificationStatus: {
    type: String,
    enum: ['success', 'partial_failure', 'failure', 'skipped'],
    description: 'Status of last notification dispatch attempt'
  },

  lastNotificationError: {
    type: String,
    description: 'Error message from last notification dispatch (if failed)'
  },

  notificationSentCount: {
    type: Number,
    default: 0,
    description: 'Cumulative count of successful notifications dispatched'
  },

  // ISSUE #238: Optional soft delete support
  deletedAt: {
    type: Date,
    default: null,
    description: 'Timestamp when config was soft-deleted (null = active)'
  }
}, {
  timestamps: true,
  collection: 'sprintnotificationconfigs',
  strict: true
});

// ================================================================================
// ISSUE #238: INDEXES FOR EFFICIENT QUERYING
// ================================================================================

/**
 * ISSUE #238: Index 1 — Primary idempotent key lookup
 * Used in: upsert pattern to fetch existing config before update
 */
sprintNotificationConfigSchema.index(
  { sprintId: 1, groupId: 1 },
  { unique: true, sparse: true, name: 'idx_sprint_group_unique' }
);

/**
 * ISSUE #238: Index 2 — Find all configs needing notification for a sprint
 * Used in: batch notification jobs to find all groups that enabled notifications
 */
sprintNotificationConfigSchema.index(
  { sprintId: 1, enabled: 1, deletedAt: 1 },
  { name: 'idx_sprint_enabled_active' }
);

/**
 * ISSUE #238: Index 3 — Group timeline of notification configs
 * Used in: audit and status queries for a group across all sprints
 */
sprintNotificationConfigSchema.index(
  { groupId: 1, updatedAt: -1 },
  { name: 'idx_group_timeline' }
);

/**
 * ISSUE #238: Index 4 — Find configs needing retry or resolution
 * Used in: monitor/alert systems to find failed notification attempts
 */
sprintNotificationConfigSchema.index(
  { lastNotificationStatus: 1, lastNotificationAt: 1 },
  { name: 'idx_notification_status_timeline' }
);

// ================================================================================
// ISSUE #238: PRE-SAVE HOOK — Generate composite key
// ================================================================================

/**
 * ISSUE #238: Pre-save hook to generate idempotent composite key
 *
 * Purpose: Ensures _uniqueKey is always set before save, enabling upsert pattern
 * to work correctly. Prevents duplicate configurations for same sprint+group.
 *
 * Pattern: Extends existing SprintConfig approach for consistency
 */
sprintNotificationConfigSchema.pre('save', function(next) {
  // ISSUE #238: Generate unique composite key if not already set
  if (!this._uniqueKey || this.isModified('sprintId') || this.isModified('groupId')) {
    this._uniqueKey = `${this.sprintId}#${this.groupId}`;
  }

  // ISSUE #238: Auto-update updatedAt timestamp on any modification
  if (this.isModified()) {
    this.updatedAt = new Date();
  }

  next();
});

// ================================================================================
// ISSUE #238: INSTANCE METHODS
// ================================================================================

/**
 * ISSUE #238: Validate configuration object for correctness
 *
 * Returns: { isValid: boolean, errors: string[] }
 */
sprintNotificationConfigSchema.methods.isValid = function() {
  const errors = [];

  // ISSUE #238: Check required fields
  if (!this.sprintId) {
    errors.push('sprintId is required');
  }
  if (!this.groupId) {
    errors.push('groupId is required');
  }

  // ISSUE #238: Check enum values
  if (this.studentDeliveryMethod && !Object.values(DELIVERY_METHODS).includes(this.studentDeliveryMethod)) {
    errors.push(`studentDeliveryMethod must be one of: ${Object.values(DELIVERY_METHODS).join(', ')}`);
  }
  if (this.coordinatorDeliveryMethod && !Object.values(DELIVERY_METHODS).includes(this.coordinatorDeliveryMethod)) {
    errors.push(`coordinatorDeliveryMethod must be one of: ${Object.values(DELIVERY_METHODS).join(', ')}`);
  }

  // ISSUE #238: Check retry configuration
  if (this.maxRetryAttempts < 1 || this.maxRetryAttempts > 5) {
    errors.push('maxRetryAttempts must be between 1 and 5');
  }
  if (!Array.isArray(this.retryBackoffMs) || this.retryBackoffMs.length === 0) {
    errors.push('retryBackoffMs must be a non-empty array of milliseconds');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * ISSUE #238: Check if notifications are enabled for this sprint
 *
 * Considers: master enabled flag, student/coordinator flags
 * Returns: boolean (true if at least one notification type is enabled)
 */
sprintNotificationConfigSchema.methods.isNotificationEnabled = function() {
  // ISSUE #238: Master enable must be true, and at least one recipient type enabled
  return this.enabled && (this.notifyStudents || this.notifyCoordinator);
};

/**
 * ISSUE #238: Soft delete the configuration (preserve history)
 */
sprintNotificationConfigSchema.methods.softDelete = function() {
  // ISSUE #238: Set deletedAt to current time to mark as inactive
  this.deletedAt = new Date();
  this.enabled = false;
  return this.save();
};

/**
 * ISSUE #238: Record successful notification dispatch attempt
 *
 * Updates lastNotificationAt, lastNotificationStatus, notificationSentCount
 */
sprintNotificationConfigSchema.methods.recordSuccessfulDispatch = function() {
  // ISSUE #238: Update notification tracking fields
  this.lastNotificationAt = new Date();
  this.lastNotificationStatus = 'success';
  this.lastNotificationError = null;
  this.notificationSentCount = (this.notificationSentCount || 0) + 1;
  return this.save();
};

/**
 * ISSUE #238: Record failed notification dispatch attempt
 *
 * @param {String} errorMessage - Error description
 * @param {Boolean} isPartialFailure - true if some recipients got notified, false for total failure
 */
sprintNotificationConfigSchema.methods.recordFailedDispatch = function(errorMessage, isPartialFailure = false) {
  // ISSUE #238: Update notification tracking fields
  this.lastNotificationAt = new Date();
  this.lastNotificationStatus = isPartialFailure ? 'partial_failure' : 'failure';
  this.lastNotificationError = errorMessage;
  return this.save();
};

// ================================================================================
// ISSUE #238: STATIC METHODS FOR QUERY PATTERNS
// ================================================================================

/**
 * ISSUE #238: Find configuration for a specific sprint+group pair
 *
 * @param {String} sprintId - Sprint ID
 * @param {String} groupId - Group ID
 * @returns {Promise<Object|null>} Configuration or null if not found
 */
sprintNotificationConfigSchema.statics.findForSprint = function(sprintId, groupId) {
  // ISSUE #238: Use idempotent key pattern for efficient lookup
  return this.findOne({
    sprintId,
    groupId,
    deletedAt: null  // Only active configs
  });
};

/**
 * ISSUE #238: Find all active notification configs for a sprint
 *
 * Used by: batch notification job to find which groups need notification dispatch
 *
 * @param {String} sprintId - Sprint ID
 * @returns {Promise<Object[]>} Array of active configs for sprint
 */
sprintNotificationConfigSchema.statics.findActiveForSprint = function(sprintId) {
  // ISSUE #238: Find all groups that have notifications enabled for this sprint
  return this.find({
    sprintId,
    enabled: true,
    deletedAt: null
  }).lean();
};

/**
 * ISSUE #238: Find all active configs for a group across all sprints
 *
 * Used by: audit queries, group-level statistics
 *
 * @param {String} groupId - Group ID
 * @returns {Promise<Object[]>} Array of active configs for group
 */
sprintNotificationConfigSchema.statics.findActiveForGroup = function(groupId) {
  // ISSUE #238: Find all sprints that have notifications enabled for this group
  return this.find({
    groupId,
    enabled: true,
    deletedAt: null
  }).sort({ createdAt: -1 }).lean();
};

/**
 * ISSUE #238: Query helper to get only active (non-deleted) configs
 */
sprintNotificationConfigSchema.query.active = function() {
  // ISSUE #238: Filter out soft-deleted configurations
  return this.where({ deletedAt: null });
};

// ================================================================================
// ISSUE #238: SCHEMA EXPORTS
// ================================================================================

// ISSUE #238: Export enums for use in other services/controllers
sprintNotificationConfigSchema.statics.RECIPIENT_TYPES = RECIPIENT_TYPES;
sprintNotificationConfigSchema.statics.DELIVERY_METHODS = DELIVERY_METHODS;
sprintNotificationConfigSchema.statics.RECIPIENT_STRATEGIES = RECIPIENT_STRATEGIES;

module.exports = mongoose.model('SprintNotificationConfig', sprintNotificationConfigSchema);
