const axios = require('axios');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

/**
 * FIX #5: STANDARDIZED NOTIFICATION PAYLOAD CONTRACTS
 * All notification dispatchers now follow consistent contract:
 * - type: notification type identifier
 * - recipient/recipients: at root level (not in payload)
 * - payload: object with snake_case fields only
 * 
 * DEFICIENCY: Previous payloads mixed camelCase, snake_case, and inconsistent structures
 * PROBLEM: Notification Service rejects requests with inconsistent contracts
 *          Leads to silent failures when payload doesn't match expected schema
 * SOLUTION: Enforce strict structure across all 7 dispatchers for contract consistency
 */

/**
 * Dispatch a GROUP_INVITATION notification to a student.
 * Called by Process 2.3 (DFD flow f06: 2.3 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string} payload.inviteeId   - student receiving the invitation
 * @param {string} payload.invitedBy   - leader who sent the invite
 * @returns {object} { notification_id }
 */
const dispatchInvitationNotification = async ({ groupId, groupName, inviteeId, invitedBy }) => {
  // FIX #5 CHANGE: Standardized payload contract with snake_case only
  // recipient moved to root level for consistency; all data in payload object
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'approval_request',
      recipient: inviteeId,
      payload: {
        group_id: groupId,
        group_name: groupName,
        invited_by: invitedBy,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a MEMBERSHIP_DECISION notification after a student accepts/rejects.
 * Called by Process 2.4 (DFD flow f08: 2.4 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string} payload.studentId   - student who made the decision
 * @param {string} payload.decision    - 'accepted' | 'rejected'
 * @param {Date}   payload.decidedAt
 * @returns {object} { notification_id }
 */
const dispatchMembershipDecisionNotification = async ({ groupId, groupName, studentId, decision, decidedAt }) => {
  // FIX #5 CHANGE: Standardized payload contract with snake_case only
  // recipient at root; all notification data in payload object
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'membership_decision',
      recipient: studentId,
      payload: {
        group_id: groupId,
        group_name: groupName,
        decision,
        decided_at: decidedAt,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a GROUP_CREATED notification after a group is successfully created.
 * Called by Process 2.1 (DFD flow f03: 2.1 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string} payload.leaderId
 * @returns {object} { notification_id }
 */
const dispatchGroupCreationNotification = async ({ groupId, groupName, leaderId }) => {
  // FIX #5 CHANGE: Standardized payload contract with snake_case only
  // recipient at root; notification data in payload object
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'group_created',
      recipient: leaderId,
      payload: {
        group_id: groupId,
        group_name: groupName,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a batch APPROVAL_REQUEST notification to multiple students.
 * Called by Process 2.4 (DFD flow f07: 2.4 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string[]} payload.recipients  - student IDs to notify
 * @param {string} payload.invitedBy     - leader who sent the invites
 * @returns {object} { notification_id, delivered_to[], sent_at }
 */
const dispatchBatchInvitationNotification = async ({ groupId, groupName, recipients, invitedBy }) => {
  // FIX #5 CHANGE: Standardized payload contract with snake_case only
  // recipients at root level; all notification data in payload object
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'approval_request',
      recipients,
      payload: {
        group_id: groupId,
        group_name: groupName,
        invited_by: invitedBy,
        message: `You have been invited to join the group "${groupName}"`,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch an ADVISEE_REQUEST notification to a professor.
 * Called by Process 3.3 (DFD flow f05: 3.3 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string} payload.professorId  - professor receiving the request
 * @param {string} payload.requesterId  - group leader requesting
 * @param {string} payload.message      - optional custom message
 * @returns {object} { notification_id }
 */
const dispatchAdvisorRequestNotification = async ({
  groupId,
  groupName,
  professorId,
  requesterId,
  message,
}) => {
  // FIX #5 CHANGE: Standardized payload contract with snake_case only
  // recipient at root level; all notification data in payload object
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'advisee_request',
      recipient: professorId,
      payload: {
        group_id: groupId,
        group_name: groupName,
        requester_id: requesterId,
        message: message || `Your group "${groupName}" is requesting advisor assignment`,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a GROUP_DISBAND notification to group members.
 * Called by Process 3.7 (DFD flow f14: 3.7 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string[]} payload.recipients  - group member IDs to notify
 * @param {string} payload.reason        - reason for disbanding
 * @returns {object} { notification_id, delivered_to[], sent_at }
 */
const dispatchDisbandNotification = async ({ groupId, groupName, recipients, reason }) => {
  // FIX #5 CHANGE: Standardized payload contract with snake_case only
  // recipients at root level; all notification data in payload object
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'group_disband',
      recipients,
      payload: {
        group_id: groupId,
        group_name: groupName,
        reason,
        message: `Your group "${groupName}" has been disbanded due to: ${reason}`,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * FIX #1: REJECTION_NOTICE DISPATCHER (NEW)
 * Dispatch a REJECTION_NOTICE notification to the Team Leader.
 * Called by Process 3.4 after professor rejects an advisee request.
 * 
 * DEFICIENCY: This dispatcher was completely missing
 * PROBLEM: When a professor rejects a request, the Team Leader is never notified
 *          No communication back to requester about rejection reason
 * SOLUTION: Implement rejection_notice dispatcher with snake_case payload contract
 *           Sends notification to group leader with rejection reason for audit trail
 *
 * @param {object} payload
 * @param {string} payload.groupId - Group whose request was rejected
 * @param {string} payload.groupName - Name of group
 * @param {string} payload.teamLeaderId - Team Leader to notify (recipient)
 * @param {string} payload.professorId - Professor who rejected
 * @param {string} payload.requestId - Request ID for reference
 * @param {string} payload.reason - Optional rejection reason
 * @returns {object} { notification_id }
 */
const dispatchRejectionNotification = async ({
  groupId,
  groupName,
  teamLeaderId,
  professorId,
  requestId,
  reason,
}) => {
  // FIX #1 IMPLEMENTATION: Send rejection notice with standardized snake_case contract
  // recipient at root level; all notification data in payload object
  // rejection_reason can be null (professor chose not to provide reason)
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'rejection_notice',
      recipient: teamLeaderId,
      payload: {
        group_id: groupId,
        group_name: groupName,
        request_id: requestId,
        professor_id: professorId,
        rejection_reason: reason || null,
        message: reason
          ? `Your advisor request has been rejected. Reason: ${reason}`
          : 'Your advisor request has been rejected.',
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchAdvisorRequestNotification,
  dispatchRejectionNotification,
  dispatchDisbandNotification,
};
