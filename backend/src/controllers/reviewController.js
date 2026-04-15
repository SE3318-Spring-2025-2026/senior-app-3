'use strict';

const axios = require('axios');
const User = require('../models/User');
const Deliverable = require('../models/Deliverable');
const Review = require('../models/Review');
const Comment = require('../models/Comment');
const AuditLog = require('../models/AuditLog');
const Group = require('../models/Group');

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

const VALID_COMMENT_TYPES = ['general', 'question', 'clarification_required', 'suggestion', 'praise'];
const VALID_SORT_FIELDS = ['timestamp', 'author', 'section', 'status'];
const VALID_STATUS_FILTERS = ['open', 'resolved', 'acknowledged'];

const SORT_MAP = {
  timestamp: { createdAt: 1 },
  author: { authorName: 1, createdAt: 1 },
  section: { sectionNumber: 1, createdAt: 1 },
  status: { status: 1, createdAt: 1 },
};

/**
 * POST /api/deliverables/:deliverableId/comments
 *
 * Process 6.2 — Add a comment (general or clarification request) to a deliverable.
 *
 * Requires: JWT (committee_member or coordinator). Students cannot initiate comments.
 * Deliverable must exist and have an active (non-completed) Review record.
 *
 * Side effects:
 *   - Creates Comment document
 *   - Updates Review status: 'pending' → 'in_progress'; 'needs_clarification' if needsResponse
 *   - Fires async notification to student group when needsResponse: true (DFD f10)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const addComment = async (req, res) => {
  const { deliverableId } = req.params;
  const { userId } = req.user;
  const {
    content,
    commentType = 'general',
    sectionNumber = null,
    needsResponse = false,
  } = req.body;

  // Validate content
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ code: 'INVALID_REQUEST', message: 'content is required' });
  }
  const trimmedContent = content.trim();
  if (trimmedContent.length < 1 || trimmedContent.length > 5000) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'content must be between 1 and 5000 characters',
    });
  }

  // Validate commentType
  if (commentType !== undefined && !VALID_COMMENT_TYPES.includes(commentType)) {
    return res.status(400).json({
      code: 'INVALID_COMMENT_TYPE',
      message: `commentType must be one of: ${VALID_COMMENT_TYPES.join(', ')}`,
    });
  }

  // Validate sectionNumber
  if (sectionNumber !== null && sectionNumber !== undefined) {
    const parsed = Number(sectionNumber);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'sectionNumber must be a positive integer',
      });
    }
  }

  // Fetch deliverable
  let deliverable;
  try {
    deliverable = await Deliverable.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[addComment] deliverable query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!deliverable) {
    return res.status(404).json({ code: 'DELIVERABLE_NOT_FOUND', message: 'Deliverable not found' });
  }

  // Deliverable must have an active (non-completed) review
  let review;
  try {
    review = await Review.findOne({ deliverableId });
  } catch (err) {
    console.error('[addComment] review query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!review || review.status === 'completed') {
    return res.status(400).json({
      code: 'NO_ACTIVE_REVIEW',
      message: 'Deliverable does not have an active review (status: under_review)',
    });
  }

  // Resolve author name from User record (fall back to userId if not found)
  let authorName = userId;
  try {
    const user = await User.findOne({ userId }).select('email').lean();
    if (user?.email) authorName = user.email;
  } catch {
    // non-fatal — default authorName already set
  }

  // Create the comment
  let comment;
  try {
    comment = await Comment.create({
      deliverableId,
      authorId: userId,
      authorName,
      content: trimmedContent,
      commentType,
      sectionNumber: sectionNumber != null ? Number(sectionNumber) : null,
      needsResponse: Boolean(needsResponse),
    });
  } catch (err) {
    console.error('[addComment] comment create error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to create comment' });
  }

  // Determine new review status
  let newReviewStatus = null;
  if (review.status === 'pending') {
    newReviewStatus = 'in_progress';
  }
  if (needsResponse) {
    newReviewStatus = 'needs_clarification';
  }

  if (newReviewStatus) {
    Review.updateOne({ deliverableId }, { $set: { status: newReviewStatus } }).catch((err) => {
      console.error('[addComment] review status update error:', err.message);
    });
  }

  // Async notification to student group when needsResponse: true (DFD f10)
  if (needsResponse) {
    setImmediate(async () => {
      try {
        const group = await Group.findOne({ groupId: deliverable.groupId })
          .select('members')
          .lean();
        const recipients = (group?.members ?? [])
          .filter((m) => m.status === 'accepted')
          .map((m) => m.userId);

        await axios.post(
          `${NOTIFICATION_SERVICE_URL}/api/notifications`,
          {
            type: 'clarification_required',
            groupId: deliverable.groupId,
            deliverableId,
            commentId: comment.commentId,
            recipients,
          },
          { timeout: 5000 }
        );
      } catch (err) {
        console.error('[addComment] notification dispatch error:', err.message);
      }
    });
  }

  // Audit log (fire-and-forget)
  AuditLog.create({
    action: 'COMMENT_CREATED',
    actorId: userId,
    targetId: comment.commentId,
    groupId: deliverable.groupId,
    payload: { deliverableId, commentType, needsResponse: Boolean(needsResponse) },
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  }).catch((err) => console.error('[addComment] audit log error:', err.message));

  return res.status(201).json({
    commentId: comment.commentId,
    deliverableId: comment.deliverableId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    content: comment.content,
    commentType: comment.commentType,
    sectionNumber: comment.sectionNumber,
    needsResponse: comment.needsResponse,
    status: comment.status,
    replies: comment.replies,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  });
};

/**
 * GET /api/deliverables/:deliverableId/comments
 *
 * Process 6.2 — Retrieve the full comment thread for a deliverable.
 *
 * Requires: JWT (any authenticated role).
 * Students can only view comments on their own group's deliverables.
 *
 * Query params:
 *   sortBy  — timestamp|author|section|status (default: timestamp)
 *   status  — open|resolved|acknowledged (optional filter)
 *   page    — default 1
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getComments = async (req, res) => {
  const { deliverableId } = req.params;
  const { role, groupId: userGroupId } = req.user;
  const { sortBy = 'timestamp', status, page = '1' } = req.query;

  // Fetch deliverable
  let deliverable;
  try {
    deliverable = await Deliverable.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[getComments] deliverable query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!deliverable) {
    return res.status(404).json({ code: 'DELIVERABLE_NOT_FOUND', message: 'Deliverable not found' });
  }

  // Students can only view comments on their own group's deliverables
  if (role === 'student' && deliverable.groupId !== userGroupId) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Students can only view comments on their own group deliverables',
    });
  }

  // Build query filter
  const filter = { deliverableId };
  if (status && VALID_STATUS_FILTERS.includes(status)) {
    filter.status = status;
  }

  // Resolve sort
  const sort = SORT_MAP[VALID_SORT_FIELDS.includes(sortBy) ? sortBy : 'timestamp'];

  // Pagination (page size fixed at 20)
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limit = 20;
  const skip = (pageNum - 1) * limit;

  let comments, totalCount, openClarificationCount;
  try {
    [comments, totalCount, openClarificationCount] = await Promise.all([
      Comment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Comment.countDocuments(filter),
      Comment.countDocuments({
        deliverableId,
        commentType: 'clarification_required',
        needsResponse: true,
        status: 'open',
      }),
    ]);
  } catch (err) {
    console.error('[getComments] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  return res.status(200).json({
    deliverableId,
    comments: comments.map((c) => ({
      commentId: c.commentId,
      authorId: c.authorId,
      authorName: c.authorName,
      content: c.content,
      commentType: c.commentType,
      sectionNumber: c.sectionNumber,
      needsResponse: c.needsResponse,
      status: c.status,
      replies: c.replies,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    totalCount,
    openClarificationCount,
  });
};

module.exports = { addComment, getComments };
