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
        'ACCOUNT_CREATED',
        'ACCOUNT_RETRIEVED',
        'ACCOUNT_UPDATED',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_CONFIRMED',
        'PASSWORD_RESET_ADMIN_INITIATED',
        'GITHUB_OAUTH_LINKED',
        'ONBOARDING_COMPLETED',
        'EMAIL_VERIFICATION_SENT',
        'EMAIL_PASSWORD_RESET_SENT',
        'EMAIL_ACCOUNT_READY_SENT',
        'EMAIL_DELIVERY_FAILED',
        'GROUP_CREATED',
        'GROUP_RETRIEVED',
        'MEMBER_REQUEST_CREATED',
        'MEMBER_REQUEST_APPROVED',
        'MEMBER_REQUEST_REJECTED',
        'MEMBER_REQUEST_OVERRIDE',
      ],
    },
    actorId: {
      type: String,
      required: true,
    },
    targetId: {
      type: String,
      required: true,
    },
    // Captured for ACCOUNT_UPDATED: { previous: {}, updated: {} }
    changes: {
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
  },
  { timestamps: true }
);

auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
