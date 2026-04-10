const axios = require('axios');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

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
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'approval_request', groupId, groupName, inviteeId, invitedBy },
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
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'membership_decision', groupId, groupName, studentId, decision, decidedAt },
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
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'general', groupId, groupName, leaderId },
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
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'approval_request',
      recipients,
      payload: {
        group_id: groupId,
        message: `You have been invited to join the group "${groupName}"`,
      },
      invitedBy,
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Issue #87: Dispatch COMMITTEE_PUBLISHED notification to all stakeholders
 * 
 * Called by committeeService.publishCommittee() in Process 4.5
 * Implements DFD Flow f09: 4.5 → Notification Service
 * 
 * Purpose:
 * Notify all relevant parties when a committee is published:
 * - Advisors (assigned in Process 4.2)
 * - Jury members (assigned in Process 4.3)
 * - Group members (students who will submit deliverables)
 * 
 * HTTP Request:
 * - URL: {NOTIFICATION_SERVICE_URL}/api/notifications
 * - Method: POST
 * - Timeout: 5000ms
 * - Payload Type: application/json
 * 
 * Payload Structure:
 * {
 *   type: 'committee_published',
 *   committeeId: string (from D3),
 *   committeeName: string (from D3),
 *   recipients: [userId1, userId2, ...] (deduplicated from advisors + jury + groups),
 *   recipientCount: number (total unique recipients),
 *   publishedAt: timestamp,
 *   publishedBy: coordinatorId
 * }
 * 
 * Response:
 * {
 *   notification_id: string,
 *   recipientCount: number
 * }
 * 
 * Error Handling:
 * - If HTTP error or timeout: exception thrown
 * - Caller (sendCommitteeNotification) handles retry logic
 * - Non-transient errors (4xx): fail immediately, no retry
 * - Transient errors (5xx, timeout): retried up to 3 times
 * 
 * Logging:
 * - Success: logs to console with recipient count
 * - Failure: exception bubbles up for caller to handle
 */
const dispatchCommitteePublishedNotification = async (payload, publishedBy) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'committee_published',
      committeeId: payload.committeeId,
      committeeName: payload.committeeName,
      recipients: payload.recipients,
      recipientCount: payload.recipientCount,
      publishedAt: payload.publishedAt,
      publishedBy,
    },
    { timeout: 5000 }
  );

  console.log(
    `[Notification] Committee ${payload.committeeId} published notification dispatched to ${payload.recipientCount} recipients`
  );

  return {
    notification_id: response.data?.notification_id || `notif_${Date.now()}`,
    recipientCount: payload.recipientCount,
  };
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchCommitteePublishedNotification,
};
