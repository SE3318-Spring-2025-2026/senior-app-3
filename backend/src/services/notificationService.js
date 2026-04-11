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
 * Issue #62 Fix #3 (CRITICAL): Transient Error Detection
 * Classify errors as transient (retryable) vs permanent (stop early).
 */
const isTransientError = (error) => {
  if (!error.response) return true;
  const status = error.response.status;
  if (status >= 400 && status < 500) return false;
  return true;
};

/**
 * Dispatch an ADVISEE_REQUEST notification to a professor with smart retry logic.
 * Called by Process 3.3 (DFD flow f33: 3.2 → Notification Service).
 */
const dispatchAdvisorRequestWithRetry = async ({ groupId, requesterId, message }) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications`,
        { type: 'advisee_request', groupId, requesterId, message: message || null },
        { timeout: 5000 }
      );
      return { ok: true, notificationId: response.data.notification_id || response.data.id, attempts: attempt };
    } catch (err) {
      lastError = err.message;
      if (!isTransientError(err)) {
        return { ok: false, attempts: attempt, lastError: `Permanent error: ${lastError}` };
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  return { ok: false, attempts: 3, lastError: `All retries failed: ${lastError}` };
};

/**
 * Dispatch Advisee Request Notification to Professor (Process 3.3)
 */
const dispatchAdviseeRequestNotification = async (payload) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    payload,
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch an ADVISOR_STATUS_CHANGE notification to team leader or professor (Process 3.5)
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
      payload: { groupId, groupName, professorId, professorName, status, message: message || null },
    },
    { timeout: 5000 }
  );
  return response.data;
};

/**
 * Dispatch a GROUP_DISBAND notification to group members.
 * Called by Process 3.7 (DFD flow f14: 3.7 → Notification Service).
 */
const dispatchDisbandNotification = async ({ groupId, groupName, recipients, reason }) => {
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

module.exports = {
  dispatchInvitationNotification,
  dispatchMembershipDecisionNotification,
  dispatchGroupCreationNotification,
  dispatchBatchInvitationNotification,
  dispatchDisbandNotification,        // From feature/67
  dispatchAdvisorStatusNotification,  // From main
  dispatchAdviseeRequestNotification, // From main
  dispatchAdvisorRequestWithRetry,    // From main
  isTransientError,                   // From main
};