const axios = require('axios');
const { retryNotificationWithBackoff } = require('./notificationRetry');
const { NOTIFICATION_TYPES } = require('../utils/operationTypes');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

/**
 * FIX #5: STANDARDIZED NOTIFICATION PAYLOAD CONTRACTS
 * All notification dispatchers follow a consistent contract:
 * - type: notification type identifier
 * - recipient/recipients: at root level
 * - payload: object with snake_case fields only
 */

/**
 * Dispatch a GROUP_INVITATION notification to a student.
 * Called by Process 2.3 (DFD flow f06: 2.3 → Notification Service).
 */
const dispatchInvitationNotification = async ({ groupId, groupName, inviteeId, invitedBy }) => {
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
 */
const dispatchMembershipDecisionNotification = async ({ groupId, groupName, studentId, decision, decidedAt }) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'membership_decision',
      recipient: studentId,
      payload: {
        group_id: groupId,
        group_name: groupName,
        membership_decision: decision,
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
 */
const dispatchGroupCreationNotification = async ({ groupId, groupName, leaderId }) => {
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
 */
const dispatchBatchInvitationNotification = async ({ groupId, groupName, recipients, invitedBy }) => {
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
 * Called by Process 3.3 (DFD flow f05).
 * Uses Fix #5 Payload + Issue #62 Retry Logic.
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

  return retryNotificationWithBackoff(dispatchFn, {
    context: { groupId, professorId, operation: 'advisee_request' },
  });
};

/**
 * Dispatch a REJECTION_NOTICE notification to the Team Leader.
 * Called by Process 3.4 when professor rejects advisor request.
 */
const dispatchRejectionNotification = async ({
  groupId,
  groupName,
  teamLeaderId,
  professorId,
  requestId,
  reason,
}) => {
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

/**
 * Dispatch an ADVISOR_STATUS_CHANGE notification to team leader or professor.
 * Called by Process 3.5 (Advisor Decision notification).
 */
const dispatchAdvisorStatusNotification = async ({
  groupId,
  groupName,
  professorId,
  professorName,
  status,
  recipientId,
  message,
}) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'advisor_status_change',
      recipient: recipientId,
      payload: {
        group_id: groupId,
        group_name: groupName,
        professor_id: professorId,
        professor_name: professorName,
        status,
        message: message || null,
      },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a GROUP_DISBAND notification to group members.
 * Called by Process 3.7 (Advisor Sanitization / DFD flow f14).
 */
const dispatchDisbandNotification = async ({ groupId, groupName, recipients, reason }) => {
  const dispatchFn = async () => {
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

  return retryNotificationWithBackoff(dispatchFn, {
    context: { groupId, operation: 'group_disband' },
  });
};

/**
 * Issue #62 Fix #3 (CRITICAL): Transient Error Detection
 */
const isTransientError = (error) => {
  if (!error.response) return true;
  const status = error.response.status;
  if (status >= 400 && status < 500) return false;
  return true;
};

const Group = require('../models/Group');

const dispatchAdvisorDecisionNotification = async ({ groupId, professorId, decision, requestId }) => {
  const group = await Group.findOne({ groupId }).lean();
  if (!group) return null;
  if (decision === 'reject') {
    return dispatchRejectionNotification({
      groupId,
      groupName: group.groupName,
      teamLeaderId: group.leaderId,
      professorId,
      requestId: requestId || group.groupId,
      reason: null,
    });
  }
  return dispatchAdvisorStatusNotification({
    groupId,
    groupName: group.groupName,
    professorId,
    professorName: '',
    status: 'assigned',
    recipientId: group.leaderId,
    message: null,
  });
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
  const recipients = (group.members || []).map((m) => m.userId).filter(Boolean);
  if (recipients.length === 0 && group.leaderId) {
    recipients.push(group.leaderId);
  }
  return dispatchDisbandNotification({
    groupId,
    groupName: group.groupName,
    recipients,
    reason: reason || 'No advisor assigned',
  });
};

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchAdvisorRequestNotification,
  dispatchRejectionNotification,
  dispatchAdvisorStatusNotification,
  dispatchAdvisorDecisionNotification,
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification,
  dispatchDisbandNotification,
  isTransientError,
};