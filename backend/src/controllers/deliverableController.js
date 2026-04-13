'use strict';

const jwt = require('jsonwebtoken');
const Group = require('../models/Group');
const Committee = require('../models/Committee');
const AuditLog = require('../models/AuditLog');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

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

module.exports = { validateGroup };
