const axios = require('axios');
const { retryNotificationWithBackoff } = require('./notificationRetry');

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
 * Dispatch a COMMITTEE_PUBLISHED notification to advisors, jury members, and optionally group members.
 * Called by Process 4.5 (DFD flow f09: 4.5 → Notification Service).
 *
 * Uses retry logic with exponential backoff (3 attempts: 100ms, 200ms, 400ms).
 * Non-fatal failures: notification dispatch errors are logged but do not block committee publish.
 *
 * @param {object} payload
 * @param {string} payload.committeeId - Committee identifier
 * @param {string} payload.committeeName - Committee name
 * @param {string[]} payload.advisorIds - Advisor user IDs to notify
 * @param {string[]} payload.juryIds - Jury member user IDs to notify
 * @param {string[]} [payload.groupMemberIds] - Optional group member user IDs to notify
 * @param {string} payload.coordinatorId - Coordinator who published the committee
 * @returns {Promise<object>} { success: boolean, notificationId: string|null, error: object|null }
 */
const dispatchCommitteePublishNotification = async ({
  committeeId,
  committeeName,
  advisorIds,
  juryIds,
  groupMemberIds,
  coordinatorId,
}) => {
  // Aggregate recipients: advisors, jury members, and optional group members
  const recipientSet = new Set();

  if (advisorIds && Array.isArray(advisorIds)) {
    advisorIds.forEach((id) => recipientSet.add(id));
  }

  if (juryIds && Array.isArray(juryIds)) {
    juryIds.forEach((id) => recipientSet.add(id));
  }

  if (groupMemberIds && Array.isArray(groupMemberIds)) {
    groupMemberIds.forEach((id) => recipientSet.add(id));
  }

  const recipients = Array.from(recipientSet);

  // Dispatch function to retry
  const dispatchFn = async () => {
    try {
      const response = await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications`,
        {
          type: 'committee_published',
          committeeId,
          committeeName,
          recipients,
          publishedBy: coordinatorId,
          publishedAt: new Date().toISOString(),
        },
        { timeout: 5000 }
      );
      return {
        success: true,
        notificationId: response.data.notification_id || response.data.notificationId,
        error: null,
      };
    } catch (err) {
      return {
        success: false,
        notificationId: null,
        error: err,
      };
    }
  };

  // Use retry logic with exponential backoff
  const result = await retryNotificationWithBackoff(dispatchFn, {
    context: {
      committeeId,
      operation: 'committee_published',
      actorId: coordinatorId,
    },
  });

  return result;
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchCommitteePublishNotification,
};
