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
 * Issue #62 Fix #3 (CRITICAL): Transient Error Detection
 * ═══════════════════════════════════════════════════════
 * Classify errors as transient (retryable) vs permanent (stop early).
 * BEFORE: All errors retried 3 times, wasting time on permanent errors (4xx).
 * AFTER:  Only retry on 5xx/timeout/network; immediately fail on 4xx.
 * BENEFIT: Reduces notification dispatch time from 5000ms to ~500ms on client errors.
 *
 * @param {Error} error - caught error during dispatch
 * @returns {boolean} true if transient (retry), false if permanent (give up)
 */
const isTransientError = (error) => {
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  if (status >= 400 && status < 500) {
    return false;
  }

  return true;
};

/**
 * Dispatch an ADVISEE_REQUEST notification to a professor with smart retry logic.
 * Called by Process 3.3 (DFD flow f33: 3.2 → Notification Service).
 * Notifies a professor that a group is requesting them as an advisor.
 *
 * Issue #62 Fix #2 (CRITICAL): Smart Retry with Transient Check
 *
 * @param {object} payload
 * @param {string} payload.groupId       - group requesting advisor
 * @param {string} payload.requesterId   - group leader requesting
 * @param {string} [payload.message]     - optional custom message
 * @returns {object} { ok, notificationId, attempts, lastError }
 */
const dispatchAdvisorRequestWithRetry = async ({ groupId, requesterId, message }) => {
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Issue #62 Fix #5 (MEDIUM): Spec-Compliant Trimmed Payload
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

      // Success
      return {
        ok: true,
        notificationId: response.data.notification_id || response.data.id,
        attempts: attempt,
        lastError: null,
      };
    } catch (err) {
      lastError = err.message;
      lastResponse = err.response;

      // Issue #62 Fix #3: Check if error is transient before retrying
      if (!isTransientError(err)) {
        return {
          ok: false,
          notificationId: null,
          attempts: attempt,
          lastError: `Permanent error (${lastResponse?.status}): ${lastError}`,
        };
      }

      // Transient error: retry with exponential backoff
      if (attempt < 3) {
        const backoffMs = 100 * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All 3 transient retry attempts exhausted
  return {
    ok: false,
    notificationId: null,
    attempts: 3,
    lastError: `All 3 retry attempts failed: ${lastError}`,
  };
};

/**
 * Issue #61 Resolution: Dispatch Advisee Request Notification to Professor
 * * Called by: Process 3.3 (adviseeNotificationService.sendAdviseeRequestNotification)
 * DFD Flow: f05 (3.3 → Notification Service)
 *
 * @param {object} payload - Notification payload
 * @returns {object} { notification_id, recipientCount }
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
 * Dispatch an ADVISOR_STATUS_CHANGE notification to team leader or professor.
 * Called by Process 3.5 (DFD flow: 3.5 → Notification Service).
 * Notifies stakeholder when advisor request is approved, released, or transferred.
 *
 * @param {object} payload
 * @param {string} payload.groupId         - group ID
 * @param {string} payload.groupName       - group name
 * @param {string} payload.professorId     - advisor professor ID
 * @param {string} payload.professorName   - advisor professor name
 * @param {string} payload.status          - 'assigned' | 'released' | 'transferred'
 * @param {string} payload.recipientId     - user to notify (team leader or old advisor)
 * @param {string} [payload.message]       - custom message (optional)
 * @returns {object} { notification_id }
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
        groupId,
        groupName,
        professorId,
        professorName,
        status,
        message: message || null,
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
  dispatchAdvisorStatusNotification,  // From feature/64
  dispatchAdviseeRequestNotification, // From main
  dispatchAdvisorRequestWithRetry,    // From feature/62
  isTransientError,                   // From feature/62
};