const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const auditLogSchema = new mongoose.Schema(
  {
    auditId: {
      type: String,
      default: () => `aud_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        // Auth & account events (SCREAMING_SNAKE_CASE, legacy)
        'ACCOUNT_CREATED',
        'ACCOUNT_RETRIEVED',
        'ACCOUNT_UPDATED',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_CONFIRMED',
        'PASSWORD_RESET_ADMIN_INITIATED',
        'GITHUB_OAUTH_LINKED',
        'GITHUB_OAUTH_INITIATED',
        'GITHUB_LINKED',
        'ONBOARDING_COMPLETED',
        'EMAIL_VERIFICATION_SENT',
        'EMAIL_PASSWORD_RESET_SENT',
        'EMAIL_ACCOUNT_READY_SENT',
        'EMAIL_DELIVERY_FAILED',
        'EMAIL_VERIFIED',
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'PASSWORD_CHANGED',
        // Group formation events (SCREAMING_SNAKE_CASE, legacy)
        'GROUP_CREATED',
        'GROUP_RETRIEVED',
        'COORDINATOR_OVERRIDE',
        'MEMBER_INVITED',
        'MEMBER_ADDED',
        'MEMBER_REMOVED',
        'MEMBER_REQUESTED',
        'NOTIFICATION_DISPATCHED',
        'MEMBERSHIP_DECISION',
        'MEMBERSHIP_DECISION_MADE',
        'MEMBERSHIP_DECISION_AUTO_DENIED',
        'STATUS_TRANSITION',
        'GITHUB_CONFIGURED',
        'JIRA_CONFIGURED',
        // Group formation events (snake_case, per issue spec)
        'group_created',
        'member_added',
        'member_removed',
        'membership_decision',
        'coordinator_override',
        'github_integration_setup',
        'jira_integration_setup',
        'status_transition',
        'sync_error',
        // Test sentinel (used in existing test suite)
        'TEST_ACTION',
      ],
    },
    actorId: {
      type: String,
      default: null,
    },
    targetId: {
      type: String,
      default: null,
    },
    // First-class group reference for group formation events
    groupId: {
      type: String,
      default: null,
      index: true,
    },
    // Consolidated event-specific data (mirrors the issue spec payload{} field)
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Captured for ACCOUNT_UPDATED: { previous: {}, updated: {} }
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    // Explicit timestamp field per issue spec (mirrors createdAt)
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Existing indexes
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
// New indexes for group formation audit queries (group_id + event_type)
auditLogSchema.index({ groupId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
