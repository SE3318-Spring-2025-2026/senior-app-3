const axios = require('axios');
const { retryNotificationWithBackoff } = require('./notificationRetry');
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
    context: { committeeId, operation: 'committee_published', actorId: coordinatorId },
  });
};

/**
 * Advisor and Group Management Notifications (From your branch).
 */
const dispatchAdvisorDecisionNotification = async ({ groupId, professorId, decision, requestId }) => {
  const group = await Group.findOne({ groupId }).lean();
  if (!group) return null;
  if (decision === 'reject') {
    // Note: Ensure dispatchRejectionNotification is defined if used
    return typeof dispatchRejectionNotification !== 'undefined' 
      ? dispatchRejectionNotification({ groupId, groupName: group.groupName, teamLeaderId: group.leaderId, professorId, requestId: requestId || group.groupId, reason: null })
      : null;
  }
  // Note: Ensure dispatchAdvisorStatusNotification is defined if used
  return typeof dispatchAdvisorStatusNotification !== 'undefined'
    ? dispatchAdvisorStatusNotification({ groupId, groupName: group.groupName, professorId, professorName: '', status: 'assigned', recipientId: group.leaderId, message: null })
    : null;
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
  const recipients = (group.members || []).map((m) => m.userId).filter(Boolean);
  if (recipients.length === 0 && group.leaderId) recipients.push(group.leaderId);
  
  // Note: Ensure dispatchDisbandNotification is defined if used
  return typeof dispatchDisbandNotification !== 'undefined'
    ? dispatchDisbandNotification({ groupId, groupName: group.groupName, recipients, reason: reason || 'No advisor assigned' })
    : null;
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchCommitteePublishNotification,
  dispatchAdvisorDecisionNotification,
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification,
  // Added missing exports if they exist in your local code:
  ...(typeof dispatchAdvisorRequestNotification !== 'undefined' && { dispatchAdvisorRequestNotification }),
  ...(typeof dispatchRejectionNotification !== 'undefined' && { dispatchRejectionNotification }),
  ...(typeof dispatchAdvisorStatusNotification !== 'undefined' && { dispatchAdvisorStatusNotification }),
  ...(typeof dispatchDisbandNotification !== 'undefined' && { dispatchDisbandNotification }),
  ...(typeof isTransientError !== 'undefined' && { isTransientError }),
};