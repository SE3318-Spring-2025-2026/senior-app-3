'use strict';

const Comment = require('../models/Comment');
const Review = require('../models/Review');
const Deliverable = require('../models/Deliverable');
const Group = require('../models/Group');
const AuditLog = require('../models/AuditLog');
const { dispatchClarificationRequiredNotification } = require('../services/notificationService');

const COMMENTS_PER_PAGE = 10;

/**
 * POST /api/v1/comments
 * Add a new comment to a deliverable review
 */
exports.addComment = async (req, res, next) => {
  try {
    const { userId, role } = req.user;
    const { deliverableId, content, commentType, sectionNumber, needsResponse } = req.body;

    // Only professors and coordinators can add comments
    if (role === 'student') {
      return res.status(403).json({ message: 'Students do not have permission to add comments' });
    }

    // Validate required fields
    if (!deliverableId) {
      return res.status(400).json({ message: 'deliverableId is required' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'content is required and cannot be empty' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ message: 'content cannot exceed 5000 characters' });
    }

    const validCommentTypes = ['general', 'question', 'clarification_required', 'suggestion', 'praise'];
    if (commentType && !validCommentTypes.includes(commentType)) {
      return res.status(400).json({ message: `commentType must be one of: ${validCommentTypes.join(', ')}` });
    }

    // Verify deliverable exists
    const deliverable = await Deliverable.findOne({ deliverableId }).lean();
    if (!deliverable) {
      return res.status(404).json({ message: 'Deliverable not found' });
    }

    // Create comment
    const comment = await Comment.create({
      deliverableId,
      authorId: userId,
      authorName: req.user.name || userId,
      content: content.trim(),
      commentType: commentType || 'general',
      sectionNumber: sectionNumber || null,
      needsResponse: needsResponse || false,
      status: 'open',
    });

    // If this is a clarification_required comment with needsResponse, update Review status
    if (commentType === 'clarification_required' && needsResponse) {
      const review = await Review.findOne({ deliverableId });
      if (review && review.status !== 'needs_clarification') {
        review.status = 'needs_clarification';
        await review.save();
      }

      // Dispatch notification
      try {
        await dispatchClarificationRequiredNotification({
          reviewId: review?.reviewId,
          deliverableId,
          commentId: comment.commentId,
          content,
        });
      } catch (notificationError) {
        console.error('Notification dispatch error:', notificationError);
      }
    }

    // Create audit log
    await AuditLog.create({
      action: 'COMMENT_ADDED',
      actorId: userId,
      payload: {
        commentId: comment.commentId,
        deliverableId,
        commentType: comment.commentType,
      },
    });

    res.status(201).json({
      commentId: comment.commentId,
      deliverableId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      content: comment.content,
      commentType: comment.commentType,
      sectionNumber: comment.sectionNumber,
      needsResponse: comment.needsResponse,
      status: comment.status,
      replies: comment.replies,
      createdAt: comment.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/comments
 * Get paginated list of comments for a deliverable
 */
exports.getComments = async (req, res, next) => {
  try {
    const { userId, role, groupId } = req.user;
    const { deliverableId, page = 1, limit = COMMENTS_PER_PAGE, status } = req.query;

    if (!deliverableId) {
      return res.status(400).json({ message: 'deliverableId query parameter is required' });
    }

    // Verify deliverable exists
    const deliverable = await Deliverable.findOne({ deliverableId }).lean();
    if (!deliverable) {
      return res.status(404).json({ message: 'Deliverable not found' });
    }

    // Students can only view comments for their own group's deliverables
    if (role === 'student') {
      const group = await Group.findOne({ groupId }).lean();
      if (!group || group.groupId !== deliverable.groupId) {
        return res.status(403).json({ message: 'You do not have permission to view comments for this deliverable' });
      }
    }

    // Build query
    const query = { deliverableId };
    if (status) {
      query.status = status;
    }

    // Get total count
    const total = await Comment.countDocuments(query);

    // Get paginated comments
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const comments = await Comment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Count open clarifications
    const openClarificationCount = await Comment.countDocuments({
      deliverableId,
      commentType: 'clarification_required',
      needsResponse: true,
      status: 'open',
    });

    res.status(200).json({
      comments,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      openClarificationCount,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/comments/:commentId
 * Edit comment content (author only)
 */
exports.editComment = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { commentId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'content is required and cannot be empty' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ message: 'content cannot exceed 5000 characters' });
    }

    // Get comment
    const comment = await Comment.findOne({ commentId });
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Verify author
    if (comment.authorId !== userId) {
      return res.status(403).json({ message: 'Only the comment author can edit this comment' });
    }

    // Update comment
    comment.content = content.trim();
    await comment.save();

    // Create audit log
    await AuditLog.create({
      action: 'COMMENT_EDITED',
      actorId: userId,
      payload: {
        commentId,
        deliverableId: comment.deliverableId,
      },
    });

    res.status(200).json({
      commentId: comment.commentId,
      deliverableId: comment.deliverableId,
      authorId: comment.authorId,
      content: comment.content,
      commentType: comment.commentType,
      status: comment.status,
      updatedAt: comment.updatedAt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/comments/:commentId/reply
 * Add a reply to a comment (student reply to clarification)
 */
exports.addReply = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { commentId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'content is required and cannot be empty' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ message: 'reply content cannot exceed 2000 characters' });
    }

    // Get comment
    const comment = await Comment.findOne({ commentId });
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Create reply
    const reply = {
      replyId: `rpl_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      authorId: userId,
      content: content.trim(),
      createdAt: new Date(),
    };

    // Add reply to comment
    comment.replies.push(reply);

    // If comment was marked as needing response, update status to acknowledged
    if (comment.needsResponse && comment.status === 'open') {
      comment.status = 'acknowledged';

      // Update Review status - if no more open clarifications, move back to in_progress
      const review = await Review.findOne({ deliverableId: comment.deliverableId });
      if (review) {
        const openClarifications = await Comment.countDocuments({
          deliverableId: comment.deliverableId,
          commentType: 'clarification_required',
          needsResponse: true,
          status: 'open',
        });

        if (openClarifications === 0) {
          review.status = 'in_progress';
          await review.save();
        }
      }
    }

    await comment.save();

    // Create audit log
    await AuditLog.create({
      action: 'COMMENT_REPLIED',
      actorId: userId,
      payload: {
        commentId,
        deliverableId: comment.deliverableId,
        replyId: reply.replyId,
      },
    });

    res.status(201).json({
      replyId: reply.replyId,
      commentId,
      authorId: reply.authorId,
      content: reply.content,
      createdAt: reply.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/comments/:commentId/resolve
 * Resolve a comment (coordinator only)
 */
exports.resolveComment = async (req, res, next) => {
  try {
    const { role } = req.user;
    const { commentId } = req.params;

    // Only coordinators can resolve comments
    if (role !== 'coordinator') {
      return res.status(403).json({ message: 'Only coordinators can resolve comments' });
    }

    // Get comment
    const comment = await Comment.findOne({ commentId });
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Update comment status
    comment.status = 'resolved';
    await comment.save();

    // Check if there are any remaining open clarifications for this deliverable
    const openClarifications = await Comment.countDocuments({
      deliverableId: comment.deliverableId,
      commentType: 'clarification_required',
      needsResponse: true,
      status: 'open',
    });

    // If no more open clarifications, update Review status
    if (openClarifications === 0) {
      const review = await Review.findOne({ deliverableId: comment.deliverableId });
      if (review && review.status === 'needs_clarification') {
        review.status = 'in_progress';
        await review.save();
      }
    }

    // Create audit log
    await AuditLog.create({
      action: 'COMMENT_RESOLVED',
      actorId: req.user.userId,
      payload: {
        commentId,
        deliverableId: comment.deliverableId,
      },
    });

    res.status(200).json({
      commentId: comment.commentId,
      deliverableId: comment.deliverableId,
      status: comment.status,
      resolvedAt: new Date(),
    });
  } catch (error) {
    next(error);
  }
};
