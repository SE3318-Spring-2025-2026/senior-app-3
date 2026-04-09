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
 * Dispatch an ADVISEE_REQUEST notification to a professor.
 * Called by Process 3.3 (DFD flow f05: 3.3 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string} payload.professorId  - professor receiving the request
 * @param {string} payload.requesterId  - group leader ID
 * @param {string} payload.message      - optional message from group leader
 * @returns {Promise<{ success, notificationId, error }>}
 */
const dispatchAdvisorRequestNotification = async ({
  groupId,
  groupName,
  professorId,
  requesterId,
  message,
}) => {
  const dispatchFn = async () => {
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/api/notifications`,
      {
        type: 'advisee_request',
        groupId,
        groupName,
        professorId,
        requesterId,
        message,
      },
      { timeout: 5000 }
    );
    return response.data;
  };

  return retryNotificationWithBackoff(dispatchFn, {
    context: { groupId, professorId, operation: 'advisee_request' },
  });
};

/**
 * Dispatch a DISBAND_NOTICE notification to all group members.
 * Called by Process 3.7 (DFD flow f14: 3.7 → Notification Service).
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.groupName
 * @param {string[]} payload.recipients  - member IDs to notify
 * @param {string} payload.reason        - reason for disband
 * @returns {Promise<{ success, notificationId, error }>}
 */
const dispatchDisbandNotification = async ({ groupId, groupName, recipients, reason }) => {
  const dispatchFn = async () => {
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/api/notifications`,
      {
        type: 'group_disband',
        groupId,
        groupName,
        recipients,
        reason,
      },
      { timeout: 5000 }
    );
    return response.data;
  };

  return retryNotificationWithBackoff(dispatchFn, {
    context: { groupId, operation: 'group_disband' },
  });
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchAdvisorRequestNotification,
  dispatchDisbandNotification,
};
