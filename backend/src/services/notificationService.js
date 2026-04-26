const axios = require('axios');
const { retryNotificationWithBackoff, isTransientError } = require('./notificationRetry');
const Group = require('../models/Group');
const { logError, logInfo } = require('../utils/structuredLogger');

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

  logInfo('Committee published notification dispatched', {
    service_name: 'notification_dispatch',
    correlationId: payload?.correlationId || null,
    externalRequestId: payload?.externalRequestId || null,
    committeeId: payload.committeeId,
    recipientCount: payload.recipientCount
  });

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
      groupId: committeeId,
      actorId: coordinatorId != null ? String(coordinatorId) : 'unknown',
    },
  });

  return {
    success: wrapped.success,
    notificationId: wrapped.notificationId,
    error: wrapped.error,
  };
};

/**
 * Issue #62: advisee_request with transient-aware retries (used by groups controller).
 */
const dispatchAdvisorRequestWithRetry = async ({
  groupId,
  requesterId,
  message,
  correlationId = null,
  externalRequestId = null
}) => {
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
        {
          timeout: 5000,
          headers: {
            ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
            ...(externalRequestId ? { 'x-external-request-id': externalRequestId } : {})
          }
        }
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

/**
 * Dispatch review assignment notification to committee members
 */
const dispatchReviewAssignmentNotification = async ({
  reviewId,
  deliverableId,
  membersToNotify,
  instructions,
}) => {
  try {
    // TODO: Implement actual notification logic
    // For now, just return success
    return {
      success: true,
      notificationId: `notif_review_${Date.now()}`,
    };
  } catch (error) {
    logError('Error dispatching review assignment notification', {
      service_name: 'notification_dispatch',
      correlationId: null,
      externalRequestId: null,
      error: error.message
    });
    throw error;
  }
};

/**
 * Dispatch clarification required notification
 */
const dispatchClarificationRequiredNotification = async ({
  reviewId,
  deliverableId,
  commentId,
  content,
}) => {
  try {
    // TODO: Implement actual notification logic
    // For now, just return success
    return {
      success: true,
      notificationId: `notif_clarif_${Date.now()}`,
    };
  } catch (error) {
    logError('Error dispatching clarification notification', {
      service_name: 'notification_dispatch',
      correlationId: null,
      externalRequestId: null,
      error: error.message
    });
    throw error;
  }
};

/**
 * ================================================================================
 * ISSUE #255: Final Grade Notifications
 * ================================================================================
 */

/**
 * ISSUE #255: Dispatch final grade notification to individual student
 * 
 * Purpose: Notify student when their final grade has been published (Process 8.5)
 */
const dispatchFinalGradeNotificationToStudent = async ({
  groupId,
  studentId,
  finalGrade,
  publishedAt,
  coordinatorId,
  groupName,
  notificationFlags = { email: true, sms: false, push: false }
}) => {
  console.log(
    `[Issue #255] Dispatching final grade notification to student ${studentId} in group ${groupId}`
  );

  try {
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/api/notifications`,
      {
        type: 'final_grade_published',
        groupId,
        studentId,
        notificationFlags: {
          email: Boolean(notificationFlags.email),
          sms: Boolean(notificationFlags.sms),
          push: Boolean(notificationFlags.push)
        },
        payload: {
          finalGrade,
          publishedAt: publishedAt.toISOString(),
          coordinatorId,
          groupName,
          message: `Your final grade for ${groupName} has been published: ${finalGrade}%`
        }
      },
      { timeout: 5000 }
    );

    return {
      success: true,
      notificationId: response.data.notification_id || `notif_fg_${Date.now()}`,
      error: null
    };
  } catch (error) {
    console.error(
      `[Issue #255] Error dispatching student notification: ${error.message}`
    );
    
    return {
      success: false,
      notificationId: null,
      error: {
        message: error.message,
        code: error.response?.status ? `HTTP_${error.response.status}` : 'NETWORK_ERROR',
        transient: isTransientError(error)
      }
    };
  }
};

/**
 * ISSUE #255: Dispatch final grade report to faculty/committee
 * 
 * Purpose: Send aggregate grade report to faculty/committee when grades published (Process 8.5)
 */
const dispatchFinalGradeReportToFaculty = async ({
  groupId,
  gradeCount,
  averageGrade,
  publishedAt,
  coordinatorId,
  groupName
}) => {
  console.log(
    `[Issue #255] Dispatching final grade report to faculty for group ${groupId}`
  );

  try {
    const response = await axios.post(
      `${NOTIFICATION_SERVICE_URL}/api/notifications`,
      {
        type: 'final_grade_report',
        groupId,
        recipients: 'faculty',
        payload: {
          gradeCount,
          averageGrade: averageGrade.toFixed(2),
          publishedAt: publishedAt.toISOString(),
          coordinatorId,
          groupName,
          message: `Final grades published for ${groupName}: ${gradeCount} students, avg: ${averageGrade.toFixed(1)}%`
        }
      },
      { timeout: 5000 }
    );

    return {
      success: true,
      notificationId: response.data.notification_id || `notif_report_${Date.now()}`,
      error: null
    };
  } catch (error) {
    console.error(
      `[Issue #255] Error dispatching faculty report: ${error.message}`
    );
    
    return {
      success: false,
      notificationId: null,
      error: {
        message: error.message,
        code: error.response?.status ? `HTTP_${error.response.status}` : 'NETWORK_ERROR',
        transient: isTransientError(error)
      }
    };
  }
};

/**
 * Dispatch JIRA sync completion notification
 */
const dispatchSyncNotification = async ({ groupId, sprintId, status, issuesProcessed, triggeredBy, correlationId }) => {
  try {
    const payload = {
      type: 'sprint_sync_completed',
      groupId,
      sprintId,
      status,
      issuesProcessed,
      triggeredBy,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    const promise = axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, payload, { timeout: 5000 });
    
    if (promise && typeof promise.catch === 'function') {
      promise.catch(error => {
        console.error('Error dispatching sync notification (async):', error.message || error);
      });
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error in dispatchSyncNotification setup:', error.message || error);
    return { success: false, error: error.message };
  }
};

const dispatchBulkFinalGradeNotifications = async (groupId, publishCycle, notificationFlags = {}) => {
  const response = await axios.post(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      type: 'final_grade_published',
      groupId,
      publishCycle,
      notificationFlags: {
        email: Boolean(notificationFlags.email),
        sms: Boolean(notificationFlags.sms),
        push: Boolean(notificationFlags.push),
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
  dispatchCommitteePublishedNotification,
  dispatchCommitteePublishNotification,
  dispatchAdvisorRequestNotification,
  dispatchAdvisorRequestWithRetry,
  dispatchAdvisorDecisionNotification,
  dispatchAdvisorStatusNotification,
  dispatchAdvisorTransferNotification,
  dispatchGroupDisbandNotification,
  dispatchDisbandNotification,
  dispatchReviewAssignmentNotification,
  dispatchClarificationRequiredNotification,
  dispatchFinalGradeNotificationToStudent,
  dispatchFinalGradeReportToFaculty,
  dispatchSyncNotification,
  dispatchBulkFinalGradeNotifications,
  isTransientError,
};
