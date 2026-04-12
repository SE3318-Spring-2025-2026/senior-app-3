const axios = require('axios');
const { retryNotificationWithBackoff } = require('./notificationRetry');
const Group = require('../models/Group');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

const dispatchInvitationNotification = async ({ groupId, groupName, inviteeId, invitedBy }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'approval_request', groupId, groupName, inviteeId, invitedBy },
    { timeout: 5000 }
  );
  return response.data;
};

const dispatchMembershipDecisionNotification = async ({
  groupId,
  groupName,
  studentId,
  decision,
  decidedAt,
}) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'membership_decision', groupId, groupName, studentId, decision, decidedAt },
    { timeout: 5000 }
  );
  return response.data;
};

const dispatchGroupCreationNotification = async ({ groupId, groupName, leaderId }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    { type: 'general', groupId, groupName, leaderId },
    { timeout: 5000 }
  );
  return response.data;
};

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
 * Used by committeeNotificationService — payload includes recipients and counts.
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

  const notificationId = response.data?.notification_id || `notif_${Date.now()}`;

  return {
    success: true,
    notificationId,
    recipientCount: payload.recipientCount,
  };
};

/**
 * Used by committeePublishService — aggregates IDs and applies retry/backoff.
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
  if (groupMemberIds && Array.isArray(groupMemberIds)) {
    groupMemberIds.forEach((id) => recipientSet.add(id));
  }

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
      return {
        success: true,
        notificationId: response.data.notification_id || response.data.notificationId,
        error: null,
      };
    } catch (err) {
      return { success: false, notificationId: null, error: err };
    }
  };

  const wrapped = await retryNotificationWithBackoff(dispatchFn, {
    maxRetries: 3,
    backoffMs: [100, 200, 400],
    context: {
      committeeId,
      groupId: 'SYSTEM',
      actorId: coordinatorId != null ? String(coordinatorId) : 'unknown',
    },
  });

  return {
    success: wrapped.success,
    notificationId: wrapped.notificationId,
    error: wrapped.error,
  };
};

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

const dispatchAdvisorDecisionNotification = async (payload) => {
  const response = await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, payload, {
    timeout: 5000,
  });
  return response.data;
};

const dispatchDisbandNotification = async (payload) => {
  const response = await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, payload, {
    timeout: 5000,
  });
  return response.data;
};

const dispatchAdvisorTransferNotification = async ({ groupId, oldProfessorId, newProfessorId }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'advisor_transfer',
      recipient: newProfessorId,
      payload: {
        group_id: groupId,
        old_professor_id: oldProfessorId,
        new_professor_id: newProfessorId,
      },
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
  const members = accepted.length > 0 ? accepted : group.leaderId ? [group.leaderId] : [];
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
  dispatchCommitteePublishedNotification,
  dispatchCommitteePublishNotification,
  dispatchAdvisorRequestNotification,
  dispatchAdvisorDecisionNotification,
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification,
  dispatchDisbandNotification,
};
