'use strict';

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Comment = require('../models/Comment');
const Review = require('../models/Review');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

const VALID_STATUSES = ['open', 'resolved', 'acknowledged'];

/**
 * Serialize a Comment document for API responses.
 */
const formatComment = (comment) => ({
  commentId: comment.commentId,
  deliverableId: comment.deliverableId,
  authorId: comment.authorId,
  authorName: comment.authorName,
  content: comment.content,
  commentType: comment.commentType,
  sectionNumber: comment.sectionNumber ?? null,
  needsResponse: comment.needsResponse,
  status: comment.status,
  replies: comment.replies.map((r) => ({
    replyId: r.replyId,
    authorId: r.authorId,
    content: r.content,
    createdAt: r.createdAt,
  })),
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
});

/**
 * PATCH /api/deliverables/:deliverableId/comments/:commentId
 *
 * Process 6.2 — Edit or resolve a comment.
 *
 * Authorization rules:
 *   - Only the comment author can update `content`
 *   - coordinator OR comment author can update `status`
 *
 * After a successful update, if no open comments with needsResponse: true remain
 * on this deliverable, the Review record is reverted to 'in_progress'.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const updateCommentHandler = async (req, res) => {
  const { deliverableId, commentId } = req.params;
  const { userId, role } = req.user;
  const { content, status } = req.body;

  if (content === undefined && status === undefined) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'At least one of content or status must be provided',
    });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      code: 'INVALID_STATUS',
      message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  let comment;
  try {
    comment = await Comment.findOne({ commentId, deliverableId });
  } catch (err) {
    console.error('[updateCommentHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!comment) {
    return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });
  }

  const isAuthor = comment.authorId === userId;
  const isCoordinator = role === 'coordinator';

  // Only comment author can edit content
  if (content !== undefined && !isAuthor) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Only the comment author can edit content',
    });
  }

  // Only coordinator or comment author can change status
  if (status !== undefined && !isAuthor && !isCoordinator) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Only the comment author or a coordinator can update status',
    });
  }

  if (content !== undefined) comment.content = content;
  if (status !== undefined) comment.status = status;

  try {
    await comment.save();
  } catch (err) {
    console.error('[updateCommentHandler] save error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to update comment' });
  }

  // If no open needsResponse comments remain, revert Review to 'in_progress'
  try {
    const openCount = await Comment.countDocuments({
      deliverableId,
      status: 'open',
      needsResponse: true,
    });
    if (openCount === 0) {
      await Review.updateOne({ deliverableId }, { $set: { status: 'in_progress' } });
    }
  } catch (err) {
    console.warn('[updateCommentHandler] Review status revert failed:', err.message);
  }

  return res.status(200).json(formatComment(comment));
};

/**
 * POST /api/deliverables/:deliverableId/comments/:commentId/reply
 *
 * Process 6.2 — Append a reply to a comment thread.
 *
 * Allowed roles: student, coordinator, committee_member.
 * Students use this to respond to clarification requests.
 *
 * Side-effects:
 *   - If comment.needsResponse === true, auto-sets comment.status = 'acknowledged'
 *   - Dispatches an async notification to the comment author (fire-and-forget)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const replyToCommentHandler = async (req, res) => {
  const { deliverableId, commentId } = req.params;
  const { userId } = req.user;
  const { content } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ code: 'INVALID_REQUEST', message: 'content is required' });
  }
  if (content.length > 2000) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'content must be 2000 characters or fewer',
    });
  }

  let comment;
  try {
    comment = await Comment.findOne({ commentId, deliverableId });
  } catch (err) {
    console.error('[replyToCommentHandler] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!comment) {
    return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });
  }

  comment.replies.push({
    replyId: `rpl_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    authorId: userId,
    content: content.trim(),
    createdAt: new Date(),
  });

  // Auto-acknowledge when this comment was waiting for a response
  if (comment.needsResponse && comment.status !== 'acknowledged') {
    comment.status = 'acknowledged';
  }

  try {
    await comment.save();
  } catch (err) {
    console.error('[replyToCommentHandler] save error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to save reply' });
  }

  // Fire-and-forget: notify the comment author that a reply has been posted
  if (comment.authorId !== userId) {
    axios
      .post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications`,
        {
          type: 'comment_reply',
          recipientId: comment.authorId,
          commentId,
          deliverableId,
          replierId: userId,
        },
        { timeout: 5000 }
      )
      .catch((err) => {
        console.warn('[replyToCommentHandler] Notification dispatch failed:', err.message);
      });
  }

  return res.status(201).json(formatComment(comment));
};

module.exports = { updateCommentHandler, replyToCommentHandler };
