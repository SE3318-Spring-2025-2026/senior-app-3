const axios = require('axios');
const { retryNotificationWithBackoff, isTransientError } = require('./notificationRetry');
const Group = require('../models/Group');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

/**
 * Dispatch a GROUP_INVITATION notification to a student.
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
 * Dispatch a MEMBERSHIP_DECISION notification.
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
 * Dispatch a GROUP_CREATED notification.
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
 * Dispatch a batch APPROVAL_REQUEST notification.
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
 * Dispatch a COMMITTEE_PUBLISHED notification (Integrated from main).
 */
const dispatchCommitteePublishNotification = async ({
  committeeId,
  committeeName,
  advisorIds,
  juryIds,
  groupMemberIds,
  coordinatorId,
}) => {
  const recipientSet = new Set();
  if (advisorIds && Array.isArray(advisorIds)) advisorIds.forEach((id) => recipientSet.add(id));
  if (juryIds && Array.isArray(juryIds)) juryIds.forEach((id) => recipientSet.add(id));
  if (groupMemberIds && Array.isArray(groupMemberIds)) groupMemberIds.forEach((id) => recipientSet.add(id));

  const recipients = Array.from(recipientSet);

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
      return { success: true, notificationId: response.data.notification_id || response.data.notificationId, error: null };
    } catch (err) {
      return { success: false, notificationId: null, error: err };
    }
  };

  return await retryNotificationWithBackoff(dispatchFn, {
    context: {
      committeeId,
      groupId: committeeId,
      operation: 'committee_published',
      actorId: coordinatorId,
    },
  });
};

/**
 * Issue #62: advisee_request with transient-aware retries (used by groups controller).
 */
const dispatchAdvisorRequestWithRetry = async ({ groupId, requesterId, message }) => {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications`,
        {
          type: 'advisee_request',
          groupId,
          requesterId,
          message: message || null,
        },
        { timeout: 5000 }
      );
      return {
        ok: true,
        notificationId: response.data.notification_id || response.data.id || response.data.notificationId,
        attempts: attempt,
        lastError: null,
      };
    } catch (err) {
      lastError = err.message;
      if (!isTransientError(err)) {
        return {
          ok: false,
          notificationId: null,
          attempts: attempt,
          lastError: `Permanent error (${err.response?.status}): ${lastError}`,
        };
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }

  return {
    ok: false,
    notificationId: null,
    attempts: 3,
    lastError: `All 3 retry attempts failed: ${lastError}`,
  };
};

/**
 * Advisor assignment status notice to group leader (Process 3.4).
 */
const dispatchAdvisorStatusNotification = async (payload) => {
  const response = await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, payload, { timeout: 5000 });
  return response.data;
};

/**
 * Advisor request — advisee submits interest in a professor (Process 3.x).
 */
const dispatchAdvisorRequestNotification = async ({
  type = 'advisee_request',
  groupId,
  professorId,
  teamLeaderId,
}) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type, groupId, professorId, teamLeaderId },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Professor approve / reject — payload includes explicit notice types for the external service.
 */
const dispatchAdvisorDecisionNotification = async (payload) => {
  const response = await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, payload, { timeout: 5000 });
  return response.data;
};

/**
 * Group disband (sanitization / admin) — members are user id strings.
 */
const dispatchDisbandNotification = async (payload) => {
  const response = await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, payload, { timeout: 5000 });
  return response.data;
};

const dispatchAdvisorTransferNotification = async ({ groupId, oldProfessorId, newProfessorId }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'advisor_transfer',
      recipient: newProfessorId,
      payload: { group_id: groupId, old_professor_id: oldProfessorId, new_professor_id: newProfessorId },
    },
    { timeout: 5000 }
  );
  return response.data;
};

const dispatchGroupDisbandNotification = async ({ groupId, reason }) => {
  const group = await Group.findOne({ groupId }).lean();
  if (!group) return null;
  const accepted = (group.members || [])
    .filter((m) => m.status === 'accepted')
    .map((m) => m.userId);
  const members = accepted.length > 0 ? accepted : (group.leaderId ? [group.leaderId] : []);
  if (members.length === 0) return null;
  return dispatchDisbandNotification({
    type: 'disband_notice',
    groupId: group.groupId,
    groupName: group.groupName,
    members,
    reason: reason || 'No advisor assigned',
  });
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchCommitteePublishNotification,
  dispatchAdvisorRequestNotification,
  dispatchAdvisorRequestWithRetry,
  dispatchAdvisorDecisionNotification,
  dispatchAdvisorStatusNotification,
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification,
  dispatchDisbandNotification,
  isTransientError,
};