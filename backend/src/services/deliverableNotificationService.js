'use strict';

/**
 * Deliverable & Review Notification Service
 *
 * Handles all stakeholder email notifications for:
 *   - Process 5.6: Post-submission (committee, coordinator, students)
 *   - Process 6:   Review workflow (assignment, clarifications, completion)
 *
 * Infrastructure:
 *   - Nodemailer with SMTP config from env vars (SMTP_HOST/EMAIL_HOST, etc.)
 *   - Single transporter instance reused across all calls
 *   - All sends are async and non-blocking
 *   - Retry up to 3 times with exponential backoff (1 s, 2 s, 4 s)
 *   - Failures logged to audit trail; no exceptions thrown to callers
 *   - Audit trail: { type, recipientId, deliverableId, sentAt, success,
 *                    templateUsed, attempts, failureReason }
 */

const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const Group = require('../models/Group');
const Committee = require('../models/Committee');
const User = require('../models/User');
const Review = require('../models/Review');
const Comment = require('../models/Comment');
const Deliverable = require('../models/Deliverable');
const AuditLog = require('../models/AuditLog');

// ─── Retry constants ──────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000; // 1 s → 2 s → 4 s

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Template loading ─────────────────────────────────────────────────────────

const TEMPLATE_DIR = path.join(__dirname, '../templates');

const _loadTemplate = (filename) => {
  try {
    return fs.readFileSync(path.join(TEMPLATE_DIR, filename), 'utf8');
  } catch {
    return null;
  }
};

// Cache templates at module-load time so disk I/O happens once.
const _templateCache = {
  'deliverable-committee.txt': _loadTemplate('deliverable-committee.txt'),
  'deliverable-coordinator.txt': _loadTemplate('deliverable-coordinator.txt'),
  'deliverable-student.txt': _loadTemplate('deliverable-student.txt'),
  'review-assignment.txt': _loadTemplate('review-assignment.txt'),
  'review-clarification-request.txt': _loadTemplate('review-clarification-request.txt'),
  'review-clarification-reply.txt': _loadTemplate('review-clarification-reply.txt'),
  'review-completed-coordinator.txt': _loadTemplate('review-completed-coordinator.txt'),
  'review-completed-student.txt': _loadTemplate('review-completed-student.txt'),
  'review-completed-committee.txt': _loadTemplate('review-completed-committee.txt'),
};

/**
 * Render a named template by replacing {{key}} placeholders with vars values.
 * Returns empty string if the template file was not found.
 */
const renderTemplate = (templateName, vars = {}) => {
  const tmpl = _templateCache[templateName] || '';
  return Object.entries(vars).reduce(
    (acc, [key, val]) =>
      acc.replaceAll(`{{${key}}}`, val != null ? String(val) : ''),
    tmpl
  );
};

// ─── Transporter (singleton) ──────────────────────────────────────────────────

const _isDevMode = () => {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  if (!user || user === 'your-email@gmail.com') return true;
  return !(
    process.env.SMTP_HOST ||
    process.env.EMAIL_HOST ||
    process.env.EMAIL_SERVICE
  );
};

let _transporter = null;

const _getTransporter = () => {
  if (_transporter) return _transporter;
  if (_isDevMode()) return null;

  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;

  if (host) {
    _transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user, pass },
    });
  } else {
    _transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: { user, pass },
    });
  }
  return _transporter;
};

// ─── Error classification ─────────────────────────────────────────────────────

const isTransientError = (err) => {
  if (!err) return false;
  const code = err.code || '';
  const responseCode = err.responseCode || 0;
  const message = (err.message || '').toLowerCase();

  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(code)) {
    return true;
  }
  if (responseCode >= 400 && responseCode < 500 && responseCode !== 452) {
    return true;
  }
  if (message.includes('connection timed out') || message.includes('network')) {
    return true;
  }
  return false;
};

// ─── Core send with retry ─────────────────────────────────────────────────────

/**
 * Send mail with up to MAX_ATTEMPTS tries and exponential backoff.
 * In dev mode (no SMTP configured) logs to console and returns success.
 *
 * @returns {{ success, messageId, attempts, error?, permanent? }}
 */
const sendWithRetry = async (mailOptions) => {
  const transporter = _getTransporter();

  if (!transporter) {
    // Dev / test mode — log and return immediately
    console.log(
      `[NOTIFY] [DEV] To: ${mailOptions.to} | Subject: ${mailOptions.subject}`
    );
    return { success: true, messageId: 'dev-mode', attempts: 0 };
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (!isTransientError(err)) {
        console.error(
          `[NOTIFY] Permanent failure (attempt ${attempt}) to ${mailOptions.to}:`,
          err.message
        );
        return { success: false, error: err.message, attempts: attempt, permanent: true };
      }
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `[NOTIFY] Transient failure (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms:`,
          err.message
        );
        await sleep(delay);
      } else {
        console.error(
          `[NOTIFY] All ${MAX_ATTEMPTS} attempts exhausted for ${mailOptions.to}:`,
          err.message
        );
      }
    }
  }
  return { success: false, error: lastError?.message, attempts: MAX_ATTEMPTS, permanent: false };
};

// ─── Audit trail ──────────────────────────────────────────────────────────────

/**
 * Best-effort audit log. Never throws.
 */
const logNotification = ({ type, recipientId, deliverableId, sentAt, success, templateUsed, attempts, failureReason }) => {
  AuditLog.create({
    action: success ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED',
    actorId: 'system',
    targetId: recipientId || null,
    groupId: null,
    payload: {
      type,
      recipientId: recipientId || null,
      deliverableId: deliverableId || null,
      sentAt: sentAt || new Date(),
      success,
      templateUsed,
      attempts,
      failureReason: failureReason || null,
    },
  }).catch((err) => {
    console.error(`[NOTIFY] Audit log failed (non-fatal):`, err.message);
  });
};

// ─── Low-level email dispatcher ───────────────────────────────────────────────

const _fromAddress = () => {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER || 'noreply@system.local';
  return `"Senior Project System" <${user}>`;
};

/**
 * Send one notification email, log result to audit trail, and return the send result.
 * Never throws.
 */
const _sendOne = async ({ to, subject, text, templateName, recipientId, deliverableId, notificationType }) => {
  try {
    const result = await sendWithRetry({ from: _fromAddress(), to, subject, text });
    const sentAt = new Date();
    logNotification({
      type: notificationType,
      recipientId,
      deliverableId,
      sentAt,
      success: result.success,
      templateUsed: templateName,
      attempts: result.attempts,
      failureReason: result.success ? null : result.error,
    });
    return { recipientId, success: result.success, attempts: result.attempts };
  } catch (err) {
    console.error(`[NOTIFY] _sendOne unexpected error for ${recipientId}:`, err.message);
    logNotification({
      type: notificationType,
      recipientId,
      deliverableId,
      sentAt: new Date(),
      success: false,
      templateUsed: templateName,
      attempts: 0,
      failureReason: err.message,
    });
    return { recipientId, success: false, attempts: 0 };
  }
};

// ─── Data queries (D1 / D2 / D3) ─────────────────────────────────────────────

/**
 * D3 — committee member users for a group's assigned committee.
 * Returns [{ userId, email }]
 */
const _getCommitteeMemberUsers = async (groupId) => {
  const group = await Group.findOne({ groupId }).select('committeeId').lean();
  if (!group?.committeeId) return [];
  const committee = await Committee.findOne({ committeeId: group.committeeId })
    .select('advisorIds juryIds')
    .lean();
  if (!committee) return [];
  const memberIds = [
    ...new Set([...(committee.advisorIds || []), ...(committee.juryIds || [])]),
  ];
  return User.find({ userId: { $in: memberIds } }).select('userId email').lean();
};

/**
 * D1 — active coordinator/admin users.
 * Returns [{ userId, email }]
 */
const _getCoordinatorUsers = async () =>
  User.find({ role: { $in: ['coordinator', 'admin'] }, accountStatus: 'active' })
    .select('userId email')
    .lean();

/**
 * D2 — accepted group member users (includes leader).
 * Returns [{ userId, email }]
 */
const _getGroupMemberUsers = async (groupId) => {
  const group = await Group.findOne({ groupId }).select('members leaderId').lean();
  if (!group) return [];
  const acceptedIds = (group.members || [])
    .filter((m) => m.status === 'accepted')
    .map((m) => m.userId);
  if (group.leaderId && !acceptedIds.includes(group.leaderId)) {
    acceptedIds.push(group.leaderId);
  }
  return User.find({ userId: { $in: acceptedIds } }).select('userId email').lean();
};

// ─── Process 5.6 Notification Functions ──────────────────────────────────────

/**
 * Notify all committee members that a new deliverable is ready for review.
 * Trigger: POST /api/deliverables/:deliverableId/notify
 * Template: deliverable-committee.txt
 *
 * @param {string} deliverableId
 * @param {string} groupId
 * @returns {Promise<Array>} per-recipient send results
 */
const notifyCommittee = async (deliverableId, groupId) => {
  let groupName = groupId;
  try {
    const g = await Group.findOne({ groupId }).select('groupName').lean();
    if (g?.groupName) groupName = g.groupName;
  } catch { /* non-fatal */ }

  const members = await _getCommitteeMemberUsers(groupId);
  return Promise.all(
    members.map(({ userId, email }) => {
      const text = renderTemplate('deliverable-committee.txt', { id: deliverableId, groupName });
      return _sendOne({
        to: email,
        subject: `New Deliverable #${deliverableId} from ${groupName} is ready for review`,
        text: text || `New Deliverable #${deliverableId} from ${groupName} is ready for review.`,
        templateName: 'deliverable-committee.txt',
        recipientId: userId,
        deliverableId,
        notificationType: 'COMMITTEE_DELIVERABLE_SUBMITTED',
      });
    })
  );
};

/**
 * Notify coordinator/admin that a deliverable was submitted.
 * Trigger: POST /api/deliverables/:deliverableId/notify
 * Template: deliverable-coordinator.txt
 *
 * @param {string} deliverableId
 * @param {string} groupId
 * @returns {Promise<Array>}
 */
const notifyCoordinator = async (deliverableId, groupId) => {
  let groupName = groupId;
  try {
    const g = await Group.findOne({ groupId }).select('groupName').lean();
    if (g?.groupName) groupName = g.groupName;
  } catch { /* non-fatal */ }

  const coordinators = await _getCoordinatorUsers();
  return Promise.all(
    coordinators.map(({ userId, email }) => {
      const text = renderTemplate('deliverable-coordinator.txt', { id: deliverableId, groupName });
      return _sendOne({
        to: email,
        subject: `Deliverable #${deliverableId} submitted by ${groupName}`,
        text: text || `Deliverable #${deliverableId} submitted by ${groupName}.`,
        templateName: 'deliverable-coordinator.txt',
        recipientId: userId,
        deliverableId,
        notificationType: 'COORDINATOR_DELIVERABLE_SUBMITTED',
      });
    })
  );
};

/**
 * Notify all group members that their submission was received.
 * Trigger: POST /api/deliverables/:deliverableId/notify
 * Template: deliverable-student.txt
 *
 * @param {string} deliverableId
 * @param {string} groupId
 * @returns {Promise<Array>}
 */
const notifyStudents = async (deliverableId, groupId) => {
  const timestamp = new Date().toISOString();
  const members = await _getGroupMemberUsers(groupId);
  return Promise.all(
    members.map(({ userId, email }) => {
      const text = renderTemplate('deliverable-student.txt', { id: deliverableId, timestamp });
      return _sendOne({
        to: email,
        subject: `Submission received — Deliverable #${deliverableId}`,
        text: text || `Submission received — ID #${deliverableId}, Time: ${timestamp}.`,
        templateName: 'deliverable-student.txt',
        recipientId: userId,
        deliverableId,
        notificationType: 'STUDENT_DELIVERABLE_RECEIVED',
      });
    })
  );
};

// ─── Process 6 Notification Functions ────────────────────────────────────────

/**
 * Notify a reviewer they have been assigned to a deliverable.
 * Trigger: Issue #186 (review assignment endpoint)
 * Template: review-assignment.txt
 *
 * @param {string} reviewId
 * @param {string} memberId
 * @returns {Promise<object|null>}
 */
const notifyReviewerAssigned = async (reviewId, memberId) => {
  const review = await Review.findOne({ reviewId }).lean();
  if (!review) return null;

  const deliverable = await Deliverable.findOne({ deliverableId: review.deliverableId }).lean();
  const group = deliverable
    ? await Group.findOne({ groupId: deliverable.groupId }).select('groupName').lean()
    : null;

  const user = await User.findOne({ userId: memberId }).select('userId email').lean();
  if (!user) return null;

  const text = renderTemplate('review-assignment.txt', {
    deliverableId: review.deliverableId,
    groupName: group?.groupName || review.groupId,
    deadline: review.deadline
      ? new Date(review.deadline).toISOString().split('T')[0]
      : 'TBD',
    instructions: review.instructions || 'No specific instructions provided.',
  });

  return _sendOne({
    to: user.email,
    subject: `Review assignment: Deliverable #${review.deliverableId}`,
    text: text || `You have been assigned to review deliverable #${review.deliverableId}.`,
    templateName: 'review-assignment.txt',
    recipientId: memberId,
    deliverableId: review.deliverableId,
    notificationType: 'REVIEWER_ASSIGNED',
  });
};

/**
 * Notify group members that a clarification was requested on their deliverable.
 * Trigger: Issue #188 when needsResponse: true comment is added
 * Template: review-clarification-request.txt
 *
 * @param {string} commentId
 * @param {string} groupId
 * @returns {Promise<Array>}
 */
const notifyClarificationRequested = async (commentId, groupId) => {
  const comment = await Comment.findOne({ commentId }).lean();
  if (!comment) return [];

  const members = await _getGroupMemberUsers(groupId);
  return Promise.all(
    members.map(({ userId, email }) => {
      const text = renderTemplate('review-clarification-request.txt', {
        deliverableId: comment.deliverableId,
        commentContent: comment.content,
      });
      return _sendOne({
        to: email,
        subject: `Clarification requested on your deliverable #${comment.deliverableId}`,
        text: text || `Clarification requested on your deliverable #${comment.deliverableId}: ${comment.content}`,
        templateName: 'review-clarification-request.txt',
        recipientId: userId,
        deliverableId: comment.deliverableId,
        notificationType: 'CLARIFICATION_REQUESTED',
      });
    })
  );
};

/**
 * Notify the reviewer that a student replied to their clarification.
 * Trigger: Issue #189 when a student posts a reply to a clarification
 * Template: review-clarification-reply.txt
 *
 * @param {string} commentId
 * @param {string} reviewerId
 * @returns {Promise<object|null>}
 */
const notifyStudentReplied = async (commentId, reviewerId) => {
  const comment = await Comment.findOne({ commentId }).lean();
  if (!comment) return null;

  const deliverable = await Deliverable.findOne({ deliverableId: comment.deliverableId }).lean();
  const group = deliverable
    ? await Group.findOne({ groupId: deliverable.groupId }).select('groupName').lean()
    : null;
  const lastReply =
    comment.replies && comment.replies.length > 0
      ? comment.replies[comment.replies.length - 1]
      : null;

  const user = await User.findOne({ userId: reviewerId }).select('userId email').lean();
  if (!user) return null;

  const text = renderTemplate('review-clarification-reply.txt', {
    groupName: group?.groupName || deliverable?.groupId || '',
    deliverableId: comment.deliverableId,
    replyContent: lastReply?.content || '',
  });

  return _sendOne({
    to: user.email,
    subject: `Reply to your clarification on deliverable #${comment.deliverableId}`,
    text: text || `A group replied to your clarification on deliverable #${comment.deliverableId}.`,
    templateName: 'review-clarification-reply.txt',
    recipientId: reviewerId,
    deliverableId: comment.deliverableId,
    notificationType: 'STUDENT_REPLIED',
  });
};

/**
 * Notify coordinator, group members, and committee when a review is completed.
 * Trigger: Issue #190 when Review status changes to 'completed'
 * Templates: review-completed-{coordinator,student,committee}.txt
 *
 * @param {string} reviewId
 * @returns {Promise<Array>} all per-recipient send results
 */
const notifyReviewCompleted = async (reviewId) => {
  const review = await Review.findOne({ reviewId }).lean();
  if (!review) return [];

  const deliverable = await Deliverable.findOne({ deliverableId: review.deliverableId }).lean();
  const group = deliverable
    ? await Group.findOne({ groupId: deliverable.groupId }).select('groupName committeeId').lean()
    : null;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const link = `${frontendUrl}/deliverables/${review.deliverableId}`;
  const groupName = group?.groupName || review.groupId || '';
  const { deliverableId } = review;

  const sends = [];

  // Notify coordinator(s) — D1
  const coordinators = await _getCoordinatorUsers();
  for (const { userId, email } of coordinators) {
    const text = renderTemplate('review-completed-coordinator.txt', { deliverableId, groupName, link });
    sends.push(
      _sendOne({
        to: email,
        subject: `Review complete: Deliverable #${deliverableId}`,
        text: text || `Review of deliverable #${deliverableId} from ${groupName} is complete. See: ${link}`,
        templateName: 'review-completed-coordinator.txt',
        recipientId: userId,
        deliverableId,
        notificationType: 'REVIEW_COMPLETED_COORDINATOR',
      })
    );
  }

  // Notify group members — D2
  if (deliverable?.groupId) {
    const members = await _getGroupMemberUsers(deliverable.groupId);
    for (const { userId, email } of members) {
      const text = renderTemplate('review-completed-student.txt', {
        deliverableId,
        sectionSummary: 'See the full comment thread for details.',
      });
      sends.push(
        _sendOne({
          to: email,
          subject: `Review complete: Your deliverable #${deliverableId}`,
          text: text || `The review of your deliverable #${deliverableId} is complete.`,
          templateName: 'review-completed-student.txt',
          recipientId: userId,
          deliverableId,
          notificationType: 'REVIEW_COMPLETED_STUDENT',
        })
      );
    }
  }

  // Notify committee members — D3
  if (deliverable?.groupId) {
    const members = await _getCommitteeMemberUsers(deliverable.groupId);
    for (const { userId, email } of members) {
      const text = renderTemplate('review-completed-committee.txt', { deliverableId });
      sends.push(
        _sendOne({
          to: email,
          subject: `Review logged as complete: Deliverable #${deliverableId}`,
          text: text || `Review of deliverable #${deliverableId} has been logged as complete.`,
          templateName: 'review-completed-committee.txt',
          recipientId: userId,
          deliverableId,
          notificationType: 'REVIEW_COMPLETED_COMMITTEE',
        })
      );
    }
  }

  return Promise.all(sends);
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Process 5.6
  notifyCommittee,
  notifyCoordinator,
  notifyStudents,
  // Process 6
  notifyReviewerAssigned,
  notifyClarificationRequested,
  notifyStudentReplied,
  notifyReviewCompleted,
  // Exposed for unit testing
  _internal: {
    renderTemplate,
    sendWithRetry,
    isTransientError,
    logNotification,
    _getTransporter,
    _isDevMode,
  },
};
