const { dispatchAdviseeRequestNotification } = require('./notificationService');
const { withRetry } = require('./notificationRetry');
const { createAuditLog } = require('./auditService');
const AdvisorRequest = require('../models/AdvisorRequest');

/**
 * Issue #61: Advisee request notification (Process 3.3 + flow f05)
 */

const buildAdviseeRequestPayload = (requestData) => ({
  type: 'advisee_request',
  requestId: requestData.requestId,
  groupId: requestData.groupId,
  professorId: requestData.professorId,
  requesterId: requestData.requesterId,
  message: requestData.message || '',
});

/**
 * Send advisee request notification with retries; returns success flag (does not throw).
 */
const sendAdviseeRequestNotification = async (requestData, requesterId) => {
  try {
    const payload = buildAdviseeRequestPayload(requestData);

    const data = await withRetry(
      () => dispatchAdviseeRequestNotification(payload),
      3,
      [100, 200, 400]
    );

    const notificationId = data?.notification_id ?? data?.notificationId ?? null;

    await createAuditLog({
      action: 'NOTIFICATION_DISPATCHED',
      actorId: requesterId,
      targetId: requestData.groupId,
      groupId: requestData.groupId,
      payload: {
        requestId: requestData.requestId,
        professorId: requestData.professorId,
        type: 'advisee_request',
        notificationId,
      },
    });

    await AdvisorRequest.findOneAndUpdate(
      { requestId: requestData.requestId },
      { $set: { notificationTriggered: true } }
    );

    return {
      success: true,
      notificationId,
    };
  } catch (error) {
    console.error('[Notification] Advisee request notification failed:', {
      requestId: requestData.requestId,
      error: error.message,
    });

    try {
      await createAuditLog({
        action: 'ADVISOR_REQUEST_NOTIFICATION_FAILED',
        actorId: requesterId,
        targetId: requestData.groupId,
        groupId: requestData.groupId,
        payload: {
          requestId: requestData.requestId,
          professorId: requestData.professorId,
          error: error.message,
        },
      });
    } catch (logError) {
      console.error('[Notification] Failed to log notification error:', logError.message);
    }

    try {
      await AdvisorRequest.findOneAndUpdate(
        { requestId: requestData.requestId },
        { $set: { notificationTriggered: false } }
      );
    } catch (updateErr) {
      console.error('[Notification] Failed to persist notificationTriggered:', updateErr.message);
    }

    return {
      success: false,
      notificationId: null,
      error: error.message,
    };
  }
};

module.exports = {
  buildAdviseeRequestPayload,
  sendAdviseeRequestNotification,
};
