/**
 * Group Status Enum & State Machine Constants
 * Issue #52: Group Status Transitions & Lifecycle Management
 *
 * Defines valid group statuses and allowed status transitions.
 */

const GROUP_STATUS = {
  PENDING_VALIDATION: 'pending_validation',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  REJECTED: 'rejected',
};

/**
 * Valid status transitions defined by the state machine.
 *
 * State transitions:
 * - pending_validation → active (after 2.2 validation + 2.5 processing)
 * - pending_validation → rejected (if validation fails in 2.2)
 * - active → inactive (triggered by coordinator or sanitization protocol)
 * - any → rejected (triggered if validation fails)
 * - inactive → active (reactivate by coordinator)
 */
const VALID_STATUS_TRANSITIONS = {
  [GROUP_STATUS.PENDING_VALIDATION]: new Set([
    GROUP_STATUS.ACTIVE,
    GROUP_STATUS.REJECTED,
  ]),
  [GROUP_STATUS.ACTIVE]: new Set([
    GROUP_STATUS.INACTIVE,
    GROUP_STATUS.REJECTED,
  ]),
  [GROUP_STATUS.INACTIVE]: new Set([
    GROUP_STATUS.ACTIVE,
    GROUP_STATUS.REJECTED,
  ]),
  [GROUP_STATUS.REJECTED]: new Set([]), // Terminal state
};

/**
 * Statuses that are considered "active" (can receive new members).
 */
const ACTIVE_GROUP_STATUSES = new Set([GROUP_STATUS.ACTIVE]);

/**
 * Statuses that are considered "inactive" (cannot receive new members).
 */
const INACTIVE_GROUP_STATUSES = new Set([
  GROUP_STATUS.PENDING_VALIDATION,
  GROUP_STATUS.INACTIVE,
  GROUP_STATUS.REJECTED,
]);

module.exports = {
  GROUP_STATUS,
  VALID_STATUS_TRANSITIONS,
  ACTIVE_GROUP_STATUSES,
  INACTIVE_GROUP_STATUSES,
};
