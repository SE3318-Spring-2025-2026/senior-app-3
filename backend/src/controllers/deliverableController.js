'use strict';

const fs = require('fs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Group = require('../models/Group');
const Committee = require('../models/Committee');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const DeliverableStaging = require('../models/DeliverableStaging');
const Deliverable = require('../models/Deliverable');
const mongoose = require('mongoose');
const { hashData } = require('../utils/fileHash');
const { runFormatValidation, runDeadlineValidation } = require('../services/deliverableValidationService');
const { persistDeliverableFile, createFinalRecord } = require('../services/storageService');
const {
  notifyCommittee,
  notifyCoordinator,
  notifyStudents,
} = require('../services/deliverableNotificationService');
const { studentBelongsToGroup } = require('../utils/studentGroupMembership');

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
 *   1. Non-empty groupId in JSON body and the student is leader or accepted member of that group
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
  const rawGroupId = req.body?.groupId;
  const groupId =
    typeof rawGroupId === 'string'
      ? rawGroupId.trim()
      : rawGroupId != null
        ? String(rawGroupId).trim()
        : '';
  const userId = req.user?.userId;

  if (!groupId) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'groupId is required',
    });
  }

  // Gate 1: student must belong to the requested group (avoids wrong group when multiple DB rows match)
  const allowed = await studentBelongsToGroup(userId, groupId);
  if (!allowed) {
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
      message:
        'No published committee is linked to this group yet (group.committeeId is empty). ' +
        'Coordinator: assign this group to a committee and call POST /api/v1/committees/:committeeId/publish. ' +
        'Then refresh and try again.',
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
      message:
        'The committee linked to this group has no advisors or jury members in D3. ' +
        'Coordinator: edit the committee, add members, then publish again.',
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

  const { status, body } = await runDeadlineValidation(
    stagingId,
    sprintId,
    actorId
  );
  return res.status(status).json(body);
};

/**
 * POST /api/deliverables/:stagingId/store
 *
 * Process 5.5 — Move staged file to permanent storage, create the final Deliverable
 * record, and clean up the staging record. Point of no return.
 *
 * Prerequisites:
 *   1. JWT (student role) — enforced by route middleware
 *   2. Staging record exists and is in 'requirements_validated' status
 *
 * On success: deletes staging record, returns 201.
 * On storage failure (disk full): staging record stays intact; returns 507.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const storeDeliverableHandler = async (req, res) => {
  const { stagingId } = req.params;
  const actorId = req.user?.userId;

  // 1. Look up staging record
  let staging;
  try {
    staging = await DeliverableStaging.findOne({ stagingId });
  } catch (err) {
    console.error('[storeDeliverableHandler] DB lookup error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!staging) {
    return res.status(404).json({ code: 'STAGING_NOT_FOUND', message: 'Staging record not found' });
  }

  if (staging.status !== 'requirements_validated') {
    return res.status(400).json({
      code: 'INVALID_STAGING_STATUS',
      message: `Staging record must be in 'requirements_validated' status (current: '${staging.status}')`,
    });
  }

  // 2–4. Move file, create DB record, and delete staging.
  // Note: transactions require a replica set; standalone MongoDB is not supported.
  // The staging TTL index handles cleanup of any stale records if deleteOne fails.
  let fileInfo;
  let deliverable;

  try {
    fileInfo = persistDeliverableFile(staging);
  } catch (err) {
    if (err.statusCode === 507 || err.code === 'DISK_FULL') {
      return res.status(507).json({ code: 'DISK_FULL', message: 'Insufficient disk space — please retry later' });
    }
    if (err.statusCode === 400 && err.code === 'CHECKSUM_MISMATCH') {
      return res.status(400).json({ code: 'CHECKSUM_MISMATCH', message: err.message });
    }
    if (err.statusCode === 404 && err.code === 'FILE_NOT_FOUND') {
      return res.status(404).json({ code: 'STAGING_FILE_NOT_FOUND', message: err.message });
    }
    console.error('[storeDeliverableHandler] File persist error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to store deliverable' });
  }

  try {
    deliverable = await createFinalRecord(staging, fileInfo.savedPath);
    await DeliverableStaging.deleteOne({ stagingId });
  } catch (err) {
    console.error('[storeDeliverableHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to store deliverable' });
  }

  AuditLog.create({
    action: 'DELIVERABLE_STORED',
    actorId,
    groupId: staging.groupId,
    payload: { stagingId, deliverableId: deliverable.deliverableId },
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
  }).catch((err) => {
    console.error('[storeDeliverableHandler] Audit log error:', err.message);
  });

  const sizeMb = parseFloat((deliverable.fileSize / (1024 * 1024)).toFixed(2));

  return res.status(201).json({
    deliverableId: deliverable.deliverableId,
    groupId: deliverable.groupId,
    deliverableType: deliverable.deliverableType,
    status: deliverable.status,
    fileHash: deliverable.fileHash,
    sizeMb,
    format: deliverable.format,
    version: deliverable.version,
    submittedAt: deliverable.submittedAt.toISOString(),
  });
};

/**
 * GET /api/deliverables
 *
 * List deliverables for a group with optional filters and pagination.
 * Students may only query their own group. Coordinators may query any group.
 *
 * Query params:
 *   groupId   — required for coordinator; defaults to req.user.groupId for student
 *   sprintId  — optional filter
 *   status    — optional filter
 *   page      — default 1
 *   limit     — default 20, max 100
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const listDeliverablesHandler = async (req, res) => {
  const { role, userId, groupId: userGroupId } = req.user;

  let { groupId, sprintId, status, page, limit } = req.query;

  // Resolve groupId
  if (!groupId) {
    if (role === 'student') {
      groupId = userGroupId;
    } else {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'groupId query param is required' });
    }
  }

  // Students can only query groups they belong to
  if (role === 'student') {
    const ok = await studentBelongsToGroup(userId, groupId);
    if (!ok) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Students can only view their own group deliverables' });
    }
  }

  // Pagination
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (page - 1) * limit;

  // Build filter
  const filter = { groupId };
  if (sprintId) filter.sprintId = sprintId;
  if (status) filter.status = status;

  let deliverables, total;
  try {
    [deliverables, total] = await Promise.all([
      Deliverable.find(filter)
        .select('deliverableId deliverableType sprintId status submittedAt version')
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Deliverable.countDocuments(filter),
    ]);
  } catch (err) {
    console.error('[listDeliverablesHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  return res.status(200).json({
    groupId,
    total,
    page,
    limit,
    deliverables: deliverables.map((d) => ({
      deliverableId: d.deliverableId,
      deliverableType: d.deliverableType,
      sprintId: d.sprintId ?? null,
      status: d.status,
      submittedAt: d.submittedAt,
      version: d.version ?? 1,
    })),
  });
};

/**
 * GET /api/deliverables/:deliverableId
 *
 * Return full deliverable record including validationHistory.
 * Students can only view deliverables belonging to their own group.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getDeliverableHandler = async (req, res) => {
  const { deliverableId } = req.params;
  const { role, userId } = req.user;

  let deliverable;
  try {
    deliverable = await Deliverable.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[getDeliverableHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!deliverable) {
    return res.status(404).json({ code: 'DELIVERABLE_NOT_FOUND', message: 'Deliverable not found' });
  }

  // Students can only view their own group's deliverables
  if (role === 'student') {
    const ok = await studentBelongsToGroup(userId, deliverable.groupId);
    if (!ok) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Students can only view their own group deliverables' });
    }
  }

  return res.status(200).json({
    deliverableId: deliverable.deliverableId,
    groupId: deliverable.groupId,
    deliverableType: deliverable.deliverableType,
    sprintId: deliverable.sprintId ?? null,
    version: deliverable.version ?? 1,
    status: deliverable.status,
    submittedAt: deliverable.submittedAt,
    filePath: deliverable.filePath,
    fileHash: deliverable.fileHash,
    fileSize: deliverable.fileSize,
    format: deliverable.format,
    description: deliverable.description ?? null,
  });
};

/**
 * DELETE /api/deliverables/:deliverableId/retract
 *
 * Retract a submitted deliverable. Coordinator only.
 * Only allowed if status === 'accepted' (not yet under review).
 * Sets status = 'retracted'; does not delete the file from disk.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const retractDeliverableHandler = async (req, res) => {
  const { deliverableId } = req.params;

  let deliverable;
  try {
    deliverable = await Deliverable.findOne({ deliverableId });
  } catch (err) {
    console.error('[retractDeliverableHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!deliverable) {
    return res.status(404).json({ code: 'DELIVERABLE_NOT_FOUND', message: 'Deliverable not found' });
  }

  // Already retracted
  if (deliverable.status === 'retracted') {
    return res.status(409).json({ code: 'ALREADY_RETRACTED', message: 'Deliverable has already been retracted' });
  }

  // Only 'accepted' status can be retracted — review already started otherwise
  if (deliverable.status !== 'accepted') {
    return res.status(409).json({
      code: 'REVIEW_ALREADY_STARTED',
      message: `Cannot retract a deliverable with status '${deliverable.status}' — only 'accepted' submissions may be retracted`,
    });
  }

  try {
    await Deliverable.updateOne({ deliverableId }, { $set: { status: 'retracted' } });
  } catch (err) {
    console.error('[retractDeliverableHandler] status update error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to update deliverable status' });
  }

  AuditLog.create({
    action: 'DELIVERABLE_RETRACTED',
    actorId: req.user.userId,
    groupId: deliverable.groupId,
    payload: { deliverableId },
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  }).catch((err) => console.error('[retractDeliverableHandler] audit log error:', err.message));

  return res.status(200).json({ deliverableId, status: 'retracted' });
};

/**
 * POST /api/deliverables/:deliverableId/notify
 *
 * Process 5.6 — Queue post-submission notifications to committee, coordinator, and students.
 *
 * Prerequisites:
 *   1. JWT (any authenticated role) — enforced by route middleware
 *   2. Deliverable must exist
 *   3. Notifications must not have been sent already (notifiedAt is null)
 *
 * Returns 202 immediately; notifications are dispatched asynchronously.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const notifyDeliverableHandler = async (req, res) => {
  const { deliverableId } = req.params;

  let deliverable;
  try {
    deliverable = await Deliverable.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[notifyDeliverableHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!deliverable) {
    return res.status(404).json({ code: 'DELIVERABLE_NOT_FOUND', message: 'Deliverable not found' });
  }

  if (deliverable.notifiedAt) {
    return res.status(409).json({
      code: 'ALREADY_NOTIFIED',
      message: 'Notifications have already been sent for this deliverable',
    });
  }

  // Mark notifiedAt before dispatching to prevent duplicate sends on concurrent calls.
  try {
    await Deliverable.updateOne({ deliverableId }, { $set: { notifiedAt: new Date() } });
  } catch (err) {
    console.error('[notifyDeliverableHandler] notifiedAt update error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to mark deliverable as notified' });
  }

  // Count expected tasks for the response (best-effort; uses cached lean reads).
  const { groupId } = deliverable;
  let tasksQueued = 0;
  try {
    const [group, coordinatorCount] = await Promise.all([
      Group.findOne({ groupId }).select('committeeId members leaderId').lean(),
      User.countDocuments({ role: { $in: ['coordinator', 'admin'] }, accountStatus: 'active' }),
    ]);

    if (group?.committeeId) {
      const committee = await Committee.findOne({ committeeId: group.committeeId })
        .select('advisorIds juryIds')
        .lean();
      if (committee) {
        tasksQueued += new Set([
          ...(committee.advisorIds || []),
          ...(committee.juryIds || []),
        ]).size;
      }
    }

    tasksQueued += coordinatorCount;

    const acceptedIds = (group?.members || [])
      .filter((m) => m.status === 'accepted')
      .map((m) => m.userId);
    if (group?.leaderId && !acceptedIds.includes(group.leaderId)) {
      acceptedIds.push(group.leaderId);
    }
    tasksQueued += acceptedIds.length;
  } catch (err) {
    console.error('[notifyDeliverableHandler] task count error (non-fatal):', err.message);
  }

  // Fire-and-forget — response is already sent before these complete.
  Promise.allSettled([
    notifyCommittee(deliverableId, groupId),
    notifyCoordinator(deliverableId, groupId),
    notifyStudents(deliverableId, groupId),
  ]).catch((err) => {
    console.error('[notifyDeliverableHandler] Async dispatch error:', err.message);
  });

  AuditLog.create({
    action: 'DELIVERABLE_NOTIFIED',
    actorId: req.user?.userId || 'system',
    groupId,
    payload: { deliverableId, tasksQueued },
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
  }).catch((err) => {
    console.error('[notifyDeliverableHandler] Audit log error:', err.message);
  });

  return res.status(202).json({
    deliverableId,
    tasksQueued,
    estimatedDeliveryMinutes: 5,
  });
};

module.exports = {
  validateGroup,
  submitDeliverable,
  validateFormatHandler,
  validateDeadlineHandler,
  storeDeliverableHandler,
  listDeliverablesHandler,
  getDeliverableHandler,
  retractDeliverableHandler,
  notifyDeliverableHandler,
};
