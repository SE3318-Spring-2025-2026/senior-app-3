/**
 * Centralized list of operation types, notification types, and audit actions
 * for the Senior Project Management System.
 */

const OPERATION_TYPES = {
  GROUP_CREATION: 'group_creation',
  MEMBER_ADDITION: 'member_addition',
  ADVISOR_ASSOCIATION: 'advisor_association',
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

module.exports = {
  ...OPERATION_TYPES,
  VALID_OPERATION_TYPES: Object.values(OPERATION_TYPES),
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
};
