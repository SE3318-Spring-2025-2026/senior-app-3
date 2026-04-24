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
        'DELIVERABLE_SUBMITTED',

        // --- Advisor Association & Sanitization ---
        'advisor_request_created',
        'advisor_request_submitted',
        'advisor_approved',
        'advisor_rejected',
        'advisor_released',
        'advisor_transferred',
        'group_disbanded',
        'sanitization_run',
        'ADVISOR_REQUEST_NOTIFICATION_FAILED',

        // --- Committee Lifecycle (Issue #80 & Process 4) ---
        'COMMITTEE_CREATED',
        'COMMITTEE_ADVISORS_ASSIGNED',
        'COMMITTEE_JURY_ASSIGNED',
        'COMMITTEE_VALIDATION_PASSED',
        'COMMITTEE_VALIDATION_FAILED',
        'COMMITTEE_UPDATED',
        'COMMITTEE_PUBLISHED',
        'GROUPS_LINKED_TO_COMMITTEE',
        'SPRINT_COMMITTEE_ASSIGNED',
        'DELIVERABLE_LINKED_TO_SPRINT',
        'JURY_ASSIGNED',
        'ADVISOR_RELEASED',

        // --- Deliverable Validation (Process 5.1) ---
        'GROUP_VALIDATION_SUCCESS',
        'GROUP_VALIDATION_FAILED',

        // --- Deliverable Staging (Process 5.2) ---
        'DELIVERABLE_STAGING_CREATED',

        // --- Deliverable Format Validation (Process 5.3) ---
        'DELIVERABLE_FORMAT_VALIDATION_SUCCESS',
        'DELIVERABLE_FORMAT_VALIDATION_FAILED',

        // --- Deliverable Deadline Validation (Process 5.4) ---
        'DELIVERABLE_DEADLINE_VALIDATION_SUCCESS',
        'DELIVERABLE_DEADLINE_VALIDATION_FAILED',

        // --- Deliverable Read & Retract ---
        'DELIVERABLE_RETRACTED',

        // --- Review & Comment (Process 6) ---
        'COMMENT_CREATED',
        'REVIEW_STATUS_UPDATED',
        'REVIEW_ASSIGNED',
        'COMMENT_ADDED',
        'COMMENT_EDITED',
        'COMMENT_REPLIED',
        'COMMENT_RESOLVED',

        // --- Deliverable Storage (Process 5.5) ---
        'DELIVERABLE_STORED',

        // --- Deliverable Notifications (Process 5.6 & 6) ---
        'NOTIFICATION_SENT',
        'NOTIFICATION_FAILED',
        'DELIVERABLE_NOTIFIED',

        // --- System & Test ---
        'TEST_ACTION',

        // --- GitHub Sync (Process 7.2) ---
        'GITHUB_SYNC_INITIATED',
        'GITHUB_SYNC_COMPLETED',
        'GITHUB_SYNC_FAILED',

        // --- Sprint Notifications (Issue #238 - Process 7.5) ---
        'SPRINT_CONTRIBUTION_RECALCULATION_INITIATED',
        'SPRINT_CONTRIBUTION_RECALCULATION_COMPLETED',
        'SPRINT_CONTRIBUTION_RECALCULATION_ERROR',
        'SPRINT_CONTRIBUTIONS_RECALCULATED',
        // ISSUE #238: Notification dispatch events for sprint contribution updates
        'SPRINT_NOTIFICATION_DISPATCHED',        // ISSUE #238: Successful notification sent (student or coordinator)
        'SPRINT_NOTIFICATION_FAILED',             // ISSUE #238: Failed notification dispatch attempt (permanent after retries)
        'SPRINT_NOTIFICATION_SKIPPED',            // ISSUE #238: Notification skipped (feature disabled for sprint)
        'SPRINT_NOTIFICATION_DISPATCHER_ERROR',   // ISSUE #238: Critical error in orchestrator (unexpected failure)
        'SPRINT_GROUP_NOTIFICATION_CONFIGURED',   // ISSUE #238: Notification configuration created/updated
        'SPRINT_NOTIFICATION_CONFIG_DELETED',
        // --- JIRA Sync (Process 7.1) ---
        'JIRA_SYNC_INITIATED',
        'JIRA_SYNC_COMPLETED',
        'JIRA_SYNC_FAILED',
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
