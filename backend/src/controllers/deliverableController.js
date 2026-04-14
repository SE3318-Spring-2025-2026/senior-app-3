'use strict';

const fs = require('fs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Group = require('../models/Group');
const Committee = require('../models/Committee');
const AuditLog = require('../models/AuditLog');
const DeliverableStaging = require('../models/DeliverableStaging');
const { hashData } = require('../utils/fileHash');
const { runFormatValidation, runDeadlineValidation } = require('../services/deliverableValidationService');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const DELIVERABLE_TYPES = [
  'proposal',
  'statement_of_work',
  'demo',
  'interim_report',
  'final_report',
];

/**
 * Write a fire-and-forget audit log entry for group validation events.
 * Swallows errors so a logging failure never blocks the response.
 */
const logValidationAudit = (action, userId, groupId, reason, req) => {
  AuditLog.create({
    action,
    actorId: userId,
    groupId,
    payload: { reason },
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
  }).catch((err) => {
    console.error('Audit log write failed (validateGroup):', err.message);
  });
};

/**
 * POST /api/deliverables/validate-group
 *
 * Process 5.1 — Group + Committee gate check.
 *
 * Verifies:
 *   1. groupId in body matches req.user.groupId (set by deliverableAuthMiddleware)
 *   2. Group exists in D2 with status === 'active'
 *   3. Group has a committee assigned in D3 with at least one member
 *
 * On success, returns a short-lived validationToken (JWT, 15 min) that the
 * upload endpoint must receive before accepting a file.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const validateGroup = async (req, res) => {
  const { groupId } = req.body;
  const userId = req.user?.userId;
  const userGroupId = req.user?.groupId;

  if (!groupId) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'groupId is required',
    });
  }

  // Gate 1: groupId in body must belong to the authenticated student
  if (groupId !== userGroupId) {
    logValidationAudit('GROUP_VALIDATION_FAILED', userId, groupId, 'GROUP_ID_MISMATCH', req);
    return res.status(403).json({
      code: 'GROUP_ID_MISMATCH',
      message: 'groupId does not match your assigned group',
    });
  }

  let group;
  try {
    group = await Group.findOne({ groupId })
      .select('groupId status committeeId advisorId')
      .lean();
  } catch (err) {
    console.error('validateGroup – Group query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  // Gate 2a: group must exist
  if (!group) {
    logValidationAudit('GROUP_VALIDATION_FAILED', userId, groupId, 'GROUP_NOT_FOUND', req);
    return res.status(404).json({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  // Gate 2b: group must be active
  if (group.status !== 'active') {
    logValidationAudit('GROUP_VALIDATION_FAILED', userId, groupId, 'GROUP_NOT_ACTIVE', req);
    return res.status(409).json({
      code: 'GROUP_NOT_ACTIVE',
      message: `Group status is '${group.status}'; must be 'active' to submit deliverables`,
    });
  }

  // Gate 3: group must have a committee with at least one member
  if (!group.committeeId) {
    logValidationAudit('GROUP_VALIDATION_FAILED', userId, groupId, 'NO_COMMITTEE_ASSIGNED', req);
    return res.status(409).json({
      code: 'NO_COMMITTEE_ASSIGNED',
      message: 'No committee has been assigned to this group',
    });
  }

  let committee;
  try {
    committee = await Committee.findOne({ committeeId: group.committeeId })
      .select('committeeId advisorIds juryIds')
      .lean();
  } catch (err) {
    console.error('validateGroup – Committee query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  const memberCount =
    (committee?.advisorIds?.length ?? 0) + (committee?.juryIds?.length ?? 0);

  if (!committee || memberCount === 0) {
    logValidationAudit('GROUP_VALIDATION_FAILED', userId, groupId, 'NO_COMMITTEE_ASSIGNED', req);
    return res.status(409).json({
      code: 'NO_COMMITTEE_ASSIGNED',
      message: 'Assigned committee has no members',
    });
  }

  // All gates passed — issue a short-lived validation token
  const validAt = new Date().toISOString();
  const validationToken = jwt.sign(
    { groupId, committeeId: group.committeeId },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  logValidationAudit('GROUP_VALIDATION_SUCCESS', userId, groupId, 'SUCCESS', req);

  return res.status(200).json({
    groupId,
    committeeId: group.committeeId,
    groupStatus: group.status,
    advisorId: group.advisorId ?? null,
    validationToken,
    validAt,
  });
};

/**
 * POST /api/deliverables/submit
 *
 * Process 5.2 — Accept the deliverable file and create a staging record.
 *
 * Prerequisites (checked in order):
 *   1. File uploaded via multer (413/415 handled by middleware)
 *   2. Required body fields present: groupId, deliverableType, sprintId
 *   3. Authorization-Validation header contains a valid, unexpired JWT from Process 5.1
 *   4. groupId in body matches the groupId embedded in the validation token
 *   5. Rate limit: same group ≤ 3 submissions in the last 10 minutes
 *
 * On success, creates a DeliverableStaging document (status: 'staging', TTL: 1 hour)
 * and returns 202 with stagingId, fileHash, sizeMb, mimeType, and nextStep.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const submitDeliverable = async (req, res) => {
  const userId = req.user?.userId;
  const { groupId, deliverableType, sprintId, description } = req.body;

  // 1. File must be present (multer handles 413/415 before this point)
  if (!req.file) {
    return res.status(400).json({
      code: 'MISSING_FILE',
      message: 'A file must be attached to the request',
    });
  }

  // 2. Required body fields
  if (!groupId || !deliverableType || !sprintId) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'groupId, deliverableType, and sprintId are required',
    });
  }

  if (!DELIVERABLE_TYPES.includes(deliverableType)) {
    return res.status(400).json({
      code: 'INVALID_DELIVERABLE_TYPE',
      message: `deliverableType must be one of: ${DELIVERABLE_TYPES.join(', ')}`,
    });
  }

  // 3. Validate Authorization-Validation header
  const validationHeader = req.headers['authorization-validation'];
  if (!validationHeader) {
    return res.status(403).json({
      code: 'MISSING_VALIDATION_TOKEN',
      message: 'Authorization-Validation header is required',
    });
  }

  let tokenPayload;
  try {
    tokenPayload = jwt.verify(validationHeader, JWT_SECRET);
  } catch {
    return res.status(403).json({
      code: 'INVALID_VALIDATION_TOKEN',
      message: 'Validation token is invalid or expired',
    });
  }

  // 4. groupId in body must match the token's groupId
  if (tokenPayload.groupId !== groupId) {
    return res.status(403).json({
      code: 'GROUP_ID_MISMATCH',
      message: 'groupId does not match the validation token',
    });
  }

  // 5. Rate limit: max 3 submissions per group in 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  let recentCount;
  try {
    recentCount = await DeliverableStaging.countDocuments({
      groupId,
      createdAt: { $gte: tenMinutesAgo },
    });
  } catch (err) {
    console.error('submitDeliverable – rate limit query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (recentCount >= 3) {
    return res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many submissions. Maximum 3 submissions per group every 10 minutes.',
    });
  }

  // Compute SHA-256 hash of the uploaded file
  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(req.file.path);
  } catch (err) {
    console.error('submitDeliverable – file read error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to read uploaded file' });
  }
  const fileHash = hashData(fileBuffer);

  // Create the staging record
  const stagingId = `stg_${uuidv4().replace(/-/g, '').slice(0, 10)}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await DeliverableStaging.create({
      stagingId,
      groupId,
      deliverableType,
      sprintId,
      submittedBy: userId,
      description: description || null,
      tempFilePath: req.file.path,
      fileSize: req.file.size,
      fileHash,
      mimeType: req.file.mimetype,
      status: 'staging',
      expiresAt,
    });
  } catch (err) {
    console.error('submitDeliverable – staging record create error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to create staging record' });
  }

  AuditLog.create({
    action: 'DELIVERABLE_STAGING_CREATED',
    actorId: userId,
    groupId,
    payload: { stagingId, deliverableType, sprintId },
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
  }).catch((err) => {
    console.error('Audit log write failed (submitDeliverable):', err.message);
  });

  const sizeMb = parseFloat((req.file.size / (1024 * 1024)).toFixed(2));

  return res.status(202).json({
    stagingId,
    fileHash,
    sizeMb,
    mimeType: req.file.mimetype,
    nextStep: 'format_validation',
  });
};

/**
 * POST /api/deliverables/:stagingId/validate-format
 *
 * Process 5.3 — Validate the staged file's format and size.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const validateFormatHandler = async (req, res) => {
  const { stagingId } = req.params;
  const actorId = req.user?.userId;

  const { status, body } = await runFormatValidation(stagingId, actorId);
  return res.status(status).json(body);
};

/**
 * POST /api/deliverables/:stagingId/validate-deadline
 *
 * Process 5.4 — Validate that the submission is within deadline and the group
 * meets team requirements. Staging record must be in 'format_validated' status.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const validateDeadlineHandler = async (req, res) => {
  const { stagingId } = req.params;
  const { sprintId } = req.body;
  const actorId = req.user?.userId;

  if (!sprintId) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'sprintId is required',
    });
  }

  const { status, body } = await runDeadlineValidation(stagingId, sprintId, actorId);
  return res.status(status).json(body);
};

module.exports = { validateGroup, submitDeliverable, validateFormatHandler, validateDeadlineHandler };
