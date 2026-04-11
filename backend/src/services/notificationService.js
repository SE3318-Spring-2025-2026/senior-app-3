const axios = require('axios');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

/**
 * Dispatch a GROUP_INVITATION notification to a student.
 * Called by Process 2.3 (DFD flow f06: 2.3 → Notification Service).
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
 * Dispatch an ADVISOR_REQUEST notification to a professor.
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.professorId
 * @returns {object} { notification_id }
 */
const dispatchAdvisorRequestNotification = async ({ groupId, professorId }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'advisor_request', groupId, professorId },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch an ADVISOR_DECISION notification to a group.
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.professorId
 * @param {string} payload.decision    - 'approve' | 'reject'
 * @returns {object} { notification_id }
 */
const dispatchAdvisorDecisionNotification = async ({ groupId, professorId, decision }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'advisor_decision', groupId, professorId, decision },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch an ADVISOR_TRANSFER notification to old and new professors.
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.oldProfessorId
 * @param {string} payload.newProfessorId
 * @returns {object} { notification_id }
 */
const dispatchAdvisorTransferNotification = async ({ groupId, oldProfessorId, newProfessorId }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'advisor_transfer', groupId, oldProfessorId, newProfessorId },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a GROUP_DISBANDED notification to all group members.
 *
 * @param {object} payload
 * @param {string} payload.groupId
 * @param {string} payload.reason
 * @returns {object} { notification_id }
 */
const dispatchGroupDisbandNotification = async ({ groupId, reason }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'group_disbanded', groupId, reason },
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
  dispatchAdvisorDecisionNotification,
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification,
};
