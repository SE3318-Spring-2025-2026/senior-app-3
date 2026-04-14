'use strict';

const DeliverableStaging = require('../models/DeliverableStaging');
const SprintConfig = require('../models/SprintConfig');
const Group = require('../models/Group');
const Deliverable = require('../models/Deliverable');
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

/**
 * Process 5.4 — Check whether the current time is within the sprint deadline.
 *
 * Queries D8 (SprintConfig) for the configured deadline for this sprint + deliverableType.
 *
 * @param {string} sprintId
 * @param {string} deliverableType
 * @returns {{ onTime: boolean, deadline: Date, timeRemainingMinutes?: number, error?: string }}
 */
const checkDeadline = async (sprintId, deliverableType) => {
  let config;
  try {
    config = await SprintConfig.findOne({ sprintId, deliverableType }).lean();
  } catch (err) {
    console.error('[deliverableValidationService] checkDeadline DB error:', err.message);
    throw err;
  }

  if (!config) {
    return { onTime: false, deadline: null, error: 'DEADLINE_NOT_CONFIGURED' };
  }

  const now = Date.now();
  const deadlineMs = config.deadline.getTime();
  const onTime = now <= deadlineMs;

  if (!onTime) {
    return { onTime: false, deadline: config.deadline };
  }

  const timeRemainingMinutes = Math.floor((deadlineMs - now) / 60000);
  return { onTime: true, deadline: config.deadline, timeRemainingMinutes };
};

/**
 * Process 5.4 — Check that all group members are in a valid (confirmed/joined) state.
 *
 * Queries D2 (Group) for the group's member list. All members must have status
 * 'accepted' (the model's equivalent of confirmed/joined).
 *
 * @param {string} groupId
 * @returns {{ requirementsMet: boolean, missingMembers?: Array<{ userId: string, status: string }> }}
 */
const checkTeamRequirements = async (groupId) => {
  let group;
  try {
    group = await Group.findOne({ groupId }).select('members').lean();
  } catch (err) {
    console.error('[deliverableValidationService] checkTeamRequirements DB error:', err.message);
    throw err;
  }

  if (!group) {
    return { requirementsMet: false, missingMembers: [] };
  }

  const VALID_STATUSES = ['accepted'];
  const missing = (group.members || []).filter((m) => !VALID_STATUSES.includes(m.status));

  return {
    requirementsMet: missing.length === 0,
    missingMembers: missing.map((m) => ({ userId: m.userId, status: m.status })),
  };
};

/**
 * Process 5.4 — Aggregate eligibility check combining deadline, team requirements,
 * and prior submission count from D4.
 *
 * @param {string} stagingId
 * @param {string} sprintId
 * @returns {{ eligible: boolean, submissionVersion: number, priorSubmissions: number, reason?: string, deadlineResult?: object, teamResult?: object }}
 */
const checkSubmissionEligibility = async (stagingId, sprintId) => {
  let staging;
  try {
    staging = await DeliverableStaging.findOne({ stagingId }).lean();
  } catch (err) {
    console.error('[deliverableValidationService] checkSubmissionEligibility staging lookup error:', err.message);
    throw err;
  }

  if (!staging) {
    return { eligible: false, submissionVersion: 0, priorSubmissions: 0, reason: 'STAGING_NOT_FOUND' };
  }

  const [deadlineResult, teamResult] = await Promise.all([
    checkDeadline(sprintId, staging.deliverableType),
    checkTeamRequirements(staging.groupId),
  ]);

  if (deadlineResult.error === 'DEADLINE_NOT_CONFIGURED') {
    return {
      eligible: false,
      submissionVersion: 0,
      priorSubmissions: 0,
      reason: 'DEADLINE_NOT_CONFIGURED',
      deadlineResult,
      teamResult,
    };
  }

  if (!deadlineResult.onTime) {
    return {
      eligible: false,
      submissionVersion: 0,
      priorSubmissions: 0,
      reason: 'DEADLINE_EXCEEDED',
      deadlineResult,
      teamResult,
    };
  }

  if (!teamResult.requirementsMet) {
    return {
      eligible: false,
      submissionVersion: 0,
      priorSubmissions: 0,
      reason: 'TEAM_REQUIREMENTS_NOT_MET',
      deadlineResult,
      teamResult,
    };
  }

  // Count prior submissions in D4 for the same group + deliverableType
  let priorSubmissions = 0;
  try {
    priorSubmissions = await Deliverable.countDocuments({
      groupId: staging.groupId,
      type: staging.deliverableType,
    });
  } catch (err) {
    console.error('[deliverableValidationService] checkSubmissionEligibility D4 count error:', err.message);
    // Non-fatal — treat as 0 prior submissions
  }

  return {
    eligible: true,
    submissionVersion: priorSubmissions + 1,
    priorSubmissions,
    deadlineResult,
    teamResult,
  };
};

/**
 * Process 5.4 — Validate that the submission is within deadline and the group
 * meets team requirements. Called after format validation passes (Process 5.3).
 *
 * Steps:
 *  1. Look up staging record; return 404 if missing or not in 'format_validated' status.
 *  2. Call checkSubmissionEligibility() which runs checkDeadline() + checkTeamRequirements().
 *  3. On failure: set status = 'deadline_failed', return failure payload,
 *     trigger async notification.
 *  4. On success: set status = 'requirements_validated', return success payload.
 *
 * @param {string} stagingId
 * @param {string} sprintId
 * @param {string} actorId - userId performing the request
 * @returns {{ status: number, body: object }}
 */
const runDeadlineValidation = async (stagingId, sprintId, actorId) => {
  // 1. Look up staging record
  let staging;
  try {
    staging = await DeliverableStaging.findOne({ stagingId });
  } catch (err) {
    console.error('[deliverableValidationService] runDeadlineValidation DB lookup error:', err);
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Database query failed' } };
  }

  if (!staging) {
    return {
      status: 404,
      body: { code: 'STAGING_NOT_FOUND', message: 'Staging record not found' },
    };
  }

  if (staging.status !== 'format_validated') {
    return {
      status: 404,
      body: {
        code: 'STAGING_NOT_FOUND',
        message: `Staging record is not in format_validated status (current: ${staging.status})`,
      },
    };
  }

  // 2. Run eligibility checks
  let eligibility;
  try {
    eligibility = await checkSubmissionEligibility(stagingId, sprintId);
  } catch (err) {
    console.error('[deliverableValidationService] runDeadlineValidation eligibility error:', err);
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Eligibility check failed' } };
  }

  if (!eligibility.eligible) {
    // 3. Failure path
    try {
      await DeliverableStaging.updateOne({ stagingId }, { $set: { status: 'deadline_failed' } });
    } catch (err) {
      console.error('[deliverableValidationService] status update error (deadline_failed):', err.message);
    }

    writeAudit('DELIVERABLE_DEADLINE_VALIDATION_FAILED', actorId, staging.groupId, {
      stagingId,
      reason: eligibility.reason,
    });

    // Async notification — does not block response
    notifyValidationFailure(staging.submittedBy, stagingId, eligibility.reason);

    if (eligibility.reason === 'DEADLINE_EXCEEDED') {
      return {
        status: 403,
        body: { code: 'DEADLINE_EXCEEDED', message: 'Submission deadline has passed' },
      };
    }

    if (eligibility.reason === 'DEADLINE_NOT_CONFIGURED') {
      return {
        status: 400,
        body: { code: 'DEADLINE_NOT_CONFIGURED', message: 'No deadline configured for this sprint and deliverable type' },
      };
    }

    // TEAM_REQUIREMENTS_NOT_MET
    return {
      status: 400,
      body: {
        code: 'TEAM_REQUIREMENTS_NOT_MET',
        message: 'One or more group members do not meet membership requirements',
        missingMembers: eligibility.teamResult?.missingMembers ?? [],
      },
    };
  }

  // 4. Success path
  try {
    await DeliverableStaging.updateOne({ stagingId }, { $set: { status: 'requirements_validated' } });
  } catch (err) {
    console.error('[deliverableValidationService] status update error (requirements_validated):', err.message);
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Failed to update staging record' } };
  }

  writeAudit('DELIVERABLE_DEADLINE_VALIDATION_SUCCESS', actorId, staging.groupId, { stagingId });

  return {
    status: 200,
    body: {
      stagingId,
      deadlineOk: true,
      sprintDeadline: eligibility.deadlineResult.deadline.toISOString(),
      timeRemainingMinutes: eligibility.deadlineResult.timeRemainingMinutes,
      submissionVersion: eligibility.submissionVersion,
      priorSubmissions: eligibility.priorSubmissions,
      readyForStorage: true,
    },
  };
};

module.exports = { runFormatValidation, checkDeadline, checkTeamRequirements, checkSubmissionEligibility, runDeadlineValidation };
