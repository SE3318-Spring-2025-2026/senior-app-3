'use strict';

/**
 * Centralized operation types, notification types, and audit action constants.
 */

const OPERATION_TYPES = {
  GROUP_CREATION: 'group_creation',
  MEMBER_ADDITION: 'member_addition',
  ADVISOR_ASSOCIATION: 'advisor_association',
  ADVISOR_DECISION: 'advisor_decision',
  ADVISOR_RELEASE: 'advisor_release',
  ADVISOR_TRANSFER: 'advisor_transfer',
  ADVISOR_SANITIZATION: 'advisor_sanitization',
  DELIVERABLE_SUBMISSION: 'deliverable_submission',
};

const NOTIFICATION_TYPES = {
  ADVISOR_REQUEST: 'advisor_request',
  ADVISOR_DECISION: 'advisor_decision',
  ADVISOR_TRANSFER: 'advisor_transfer',
  GROUP_DISBANDED: 'group_disbanded',
};

const AUDIT_ACTIONS = {
  ADVISOR_REQUEST_SUBMITTED: 'advisor_request_submitted',
  ADVISOR_APPROVED: 'advisor_approved',
  ADVISOR_REJECTED: 'advisor_rejected',
  ADVISOR_RELEASED: 'advisor_released',
  ADVISOR_TRANSFERRED: 'advisor_transferred',
};

const VALID_OPERATION_TYPES = Object.values(OPERATION_TYPES);

module.exports = {
  ...OPERATION_TYPES,
  VALID_OPERATION_TYPES,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
};
