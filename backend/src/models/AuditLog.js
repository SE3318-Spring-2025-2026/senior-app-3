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
        // --- Auth & Account Events ---
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

        // --- Group Formation Events (Legacy) ---
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
        'COMMITTEE_CREATED', // Added from feature/coordinator-ui-entrypoint
        'ADVISOR_RELEASED',  // Added from feature/coordinator-ui-entrypoint

        // --- Modern Group & Integration Events (snake_case) ---
        'group_created',
        'member_added',
        'member_removed',
        'membership_decision',
        'coordinator_override',
        'github_integration_setup',
        'jira_integration_setup',
        'status_transition',
        'sync_error',

        // --- Advisor Association & Sanitization ---
        'advisor_request_created',
        'advisor_request_submitted',
        'advisor_approved',
        'advisor_rejected',
        'advisor_released',
        'advisor_transferred',
        'group_disbanded',
        'sanitization_run',
        'ADVISOR_REQUEST_NOTIFICATION_FAILED', // Added from main

        // --- System & Test ---
        'TEST_ACTION',
        // Committee events (Issue #65)
        'COMMITTEE_CREATED',
        // Jury assignment (Issue #65 / Process 4.3)
        'JURY_ASSIGNED',
        // Advisor release (Issue #65 / 3.5)
        'ADVISOR_RELEASED',
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
    groupId: {
      type: String,
      default: null,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
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
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

/**
 * INDEX STRATEGY
 * Optimized for rapid audit filtering in the Coordinator UI.
 */
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ groupId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;