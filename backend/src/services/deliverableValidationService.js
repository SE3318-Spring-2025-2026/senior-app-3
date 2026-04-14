'use strict';

const DeliverableStaging = require('../models/DeliverableStaging');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { validateFormat, validateFileSize } = require('../utils/fileValidator');

/**
 * Fire-and-forget audit log. Swallows errors so logging never blocks response.
 */
const writeAudit = (action, actorId, groupId, payload) => {
  AuditLog.create({ action, actorId, groupId, payload }).catch((err) => {
    console.error(`[deliverableValidationService] Audit log failed (${action}):`, err.message);
  });
};

/**
 * Async notification to student on validation failure (flow f13).
 * Logs to console in dev mode; does not block the response.
 *
 * @param {string} submittedBy - userId of the student
 * @param {string} stagingId
 * @param {string} reason - human-readable failure reason
 */
const notifyValidationFailure = async (submittedBy, stagingId, reason) => {
  try {
    const user = await User.findOne({ userId: submittedBy }).select('email firstName').lean();
    if (!user) return;

    // In production this would call an email/push service.
    // Dev mode logs to console — same pattern used by emailService.js.
    console.log(
      `[NOTIFICATION f13] Deliverable validation failed\n` +
      `  To     : ${user.email}\n` +
      `  staging: ${stagingId}\n` +
      `  Reason : ${reason}`
    );
  } catch (err) {
    console.error('[deliverableValidationService] f13 notification error:', err.message);
  }
};

/**
 * Process 5.3 — Validate staged file format and size.
 *
 * Steps:
 *  1. Look up staging record; return 404 if missing or expired.
 *  2. Run validateFormat() and validateFileSize().
 *  3. On any failure: set status = 'validation_failed', return failure payload,
 *     trigger async f13 notification.
 *  4. On success: set status = 'format_validated', return success payload.
 *
 * @param {string} stagingId
 * @param {string} actorId - userId performing the request
 * @returns {{ status: number, body: object }}
 */
const runFormatValidation = async (stagingId, actorId) => {
  // 1. Look up staging record
  let staging;
  try {
    staging = await DeliverableStaging.findOne({ stagingId });
  } catch (err) {
    console.error('[deliverableValidationService] DB lookup error:', err);
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Database query failed' } };
  }

  if (!staging) {
    return {
      status: 404,
      body: { code: 'STAGING_NOT_FOUND', message: 'Staging record not found' },
    };
  }

  if (staging.expiresAt < new Date()) {
    return {
      status: 404,
      body: { code: 'STAGING_EXPIRED', message: 'Staging record has expired' },
    };
  }

  // 2. Run format and size checks
  const formatResult = validateFormat(
    staging.tempFilePath,
    staging.mimeType,
    staging.deliverableType
  );

  const sizeResult = validateFileSize(staging.fileSize, staging.deliverableType);

  const allValid = formatResult.valid && sizeResult.withinLimit;

  if (!allValid) {
    // 3. Failure path
    const errors = [];
    if (!formatResult.valid) errors.push(formatResult.error);
    if (!sizeResult.withinLimit) {
      errors.push(
        `File size ${sizeResult.actualMb} MB exceeds the ${sizeResult.maxAllowedMb} MB limit ` +
        `for deliverable type '${staging.deliverableType}'`
      );
    }

    try {
      await DeliverableStaging.updateOne({ stagingId }, { $set: { status: 'validation_failed' } });
    } catch (err) {
      console.error('[deliverableValidationService] status update error (failed):', err.message);
    }

    writeAudit('DELIVERABLE_FORMAT_VALIDATION_FAILED', actorId, staging.groupId, {
      stagingId,
      errors,
    });

    // Async f13 notification — does not block response
    notifyValidationFailure(staging.submittedBy, stagingId, errors.join('; '));

    return {
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        stagingId,
        errors,
        checks: {
          formatValid: formatResult.valid,
          sizeValid: sizeResult.withinLimit,
          virusScanPassed: null,
        },
      },
    };
  }

  // 4. Success path
  try {
    await DeliverableStaging.updateOne({ stagingId }, { $set: { status: 'format_validated' } });
  } catch (err) {
    console.error('[deliverableValidationService] status update error (success):', err.message);
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Failed to update staging record' } };
  }

  writeAudit('DELIVERABLE_FORMAT_VALIDATION_SUCCESS', actorId, staging.groupId, { stagingId });

  return {
    status: 200,
    body: {
      stagingId,
      valid: true,
      format: formatResult.format,
      checks: {
        formatValid: true,
        sizeValid: true,
        virusScanPassed: null,
      },
      nextStep: 'deadline_validation',
    },
  };
};

module.exports = { runFormatValidation };
