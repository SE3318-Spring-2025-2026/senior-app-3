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
 * Issue #61 Resolution: Dispatch Advisee Request Notification to Professor
 * 
 * This function addresses PR Review Issue #4: Process 3.3 (Notification Dispatch) Missing
 * Original Problem: No notification logic for advisor requests
 * 
 * Called by: Process 3.3 (adviseeNotificationService.sendAdviseeRequestNotification)
 * DFD Flow: f05 (3.3 → Notification Service)
 * 
 * Purpose:
 * - Makes HTTP POST to external Notification Service
 * - Delivers advisee request notification to professor
 * - Part of advisory association workflow (Process 3.0)
 * 
 * Integration Point:
 * Workflow: 3.1 (Team Lead) → 3.2 (Validate) → 3.3 (Notify) → Notification Service
 * - 3.2 calls adviseeNotificationService.sendAdviseeRequestNotification()
 * - 3.3 calls this dispatchAdviseeRequestNotification()
 * - This function posts to external service
 * - D2 notificationTriggered is updated by adviseeNotificationService after dispatch (not in 201)
 *
 * @param {object} payload - Notification payload
 * @returns {object} { notification_id, recipientCount }
 */
const dispatchAdviseeRequestNotification = async (payload) => {
  /**
   * HTTP Dispatch Details:
   * - Endpoint: ${NOTIFICATION_SERVICE_URL}/api/notifications
   * - Method: POST
   * - Timeout: 5000ms (5 seconds)
   * - Payload: Full advisee request notification object
   * 
   * Expected Success Response (202 Accepted):
   * {
   *   notification_id: string,    // Unique notification ID from service
   *   recipientCount: number      // How many recipients will receive (usually 1)
   * }
   * 
   * Expected Error Responses:
   * - 400 Bad Request: Invalid payload format
   * - 500 Internal Server Error: Service error
   * - Timeout: ECONNABORTED after 5000ms
   * 
   * Retry Strategy:
   * This function doesn't retry; retry logic is in adviseeNotificationService
   * Retries: 3 attempts with [100ms, 200ms, 400ms] exponential backoff
   * 
   * Caller Responsibility:
   * adviseeNotificationService wraps this in retryNotificationWithBackoff
   * Catches errors and logs to audit trail (no silent failures)
   */
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    payload,
    { timeout: 5000 }
  );
  return response.data;
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchAdviseeRequestNotification,
};
