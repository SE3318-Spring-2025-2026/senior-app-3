'use strict';

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Comment = require('../models/Comment');
const Review = require('../models/Review');
const User = require('../models/User');
const Deliverable = require('../models/Deliverable');
const AuditLog = require('../models/AuditLog');
const Group = require('../models/Group');
const Committee = require('../models/Committee');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';

const VALID_STATUSES = ['open', 'resolved', 'acknowledged'];
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
 */

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

  // If no open needsResponse comments remain, mark Review as 'completed'
  try {
    const openCount = await Comment.countDocuments({
      deliverableId,
      status: 'open',
      needsResponse: true,
    });
    if (openCount === 0) {
      await Review.updateOne(
        { deliverableId, status: { $in: ['in_progress', 'needs_clarification'] } },
        { $set: { status: 'completed' } }
      );
    }
  } catch (err) {
    console.warn('[updateCommentHandler] Review status update failed:', err.message);
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

/**
 * POST /api/v1/reviews/assign
 *
 * Process 6.1 — Coordinator assigns a deliverable to committee members for review.
 * Fetches committee members from D3, creates a Review record in D5, updates the
 * Deliverable status to 'under_review', and triggers async assignment notifications.
 *
 * Requires: JWT (coordinator role only).
 */
const assignReview = async (req, res) => {
  const { userId } = req.user;
  const { deliverableId, reviewDeadlineDays, selectedCommitteeMembers, instructions } = req.body;

  if (!deliverableId) {
    return res.status(400).json({ code: 'INVALID_REQUEST', message: 'deliverableId is required' });
  }

  if (reviewDeadlineDays === undefined || reviewDeadlineDays === null) {
    return res.status(400).json({ code: 'INVALID_REQUEST', message: 'reviewDeadlineDays is required' });
  }

  if (!Number.isInteger(reviewDeadlineDays) || reviewDeadlineDays < 1 || reviewDeadlineDays > 30) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'reviewDeadlineDays must be an integer between 1 and 30',
    });
  }

  let deliverable;
  try {
    deliverable = await Deliverable.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[assignReview] deliverable query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!deliverable) {
    return res.status(404).json({ code: 'DELIVERABLE_NOT_FOUND', message: 'Deliverable not found' });
  }

  let existingReview;
  try {
    existingReview = await Review.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[assignReview] review query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (existingReview) {
    return res.status(409).json({
      code: 'REVIEW_ALREADY_EXISTS',
      message: 'A review is already assigned for this deliverable',
    });
  }

  if (deliverable.status !== 'accepted') {
    return res.status(400).json({
      code: 'INVALID_DELIVERABLE_STATUS',
      message: `Deliverable must have status 'accepted'; current: ${deliverable.status}`,
    });
  }

  let committee;
  try {
    committee = await Committee.findOne({ committeeId: deliverable.committeeId }).lean();
  } catch (err) {
    console.error('[assignReview] committee query error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!committee) {
    return res.status(400).json({ code: 'COMMITTEE_NOT_FOUND', message: 'Committee not found for this deliverable' });
  }

  const membersToAssign =
    selectedCommitteeMembers && selectedCommitteeMembers.length > 0
      ? selectedCommitteeMembers
      : committee.advisorIds;

  const invalidMemberIds = membersToAssign.filter((id) => !committee.advisorIds.includes(id));
  if (invalidMemberIds.length > 0) {
    return res.status(400).json({
      code: 'INVALID_MEMBER_IDS',
      message: 'Some member IDs are not valid active committee members',
      invalidMemberIds,
    });
  }

  const deadline = new Date();
  deadline.setDate(deadline.getDate() + reviewDeadlineDays);

  const assignedMembersData = membersToAssign.map((memberId) => ({ memberId, status: 'notified' }));

  let review;
  try {
    review = await Review.create({
      deliverableId,
      groupId: deliverable.groupId,
      status: 'pending',
      assignedMembers: assignedMembersData,
      deadline,
      instructions: instructions || null,
    });
  } catch (err) {
    console.error('[assignReview] review create error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to create review' });
  }

  // Update deliverable status (fire-and-forget — response should not wait on this)
  Deliverable.findOneAndUpdate({ deliverableId }, { status: 'under_review' }).catch((err) => {
    console.error('[assignReview] deliverable update error:', err.message);
  });

  // Fetch member details for response (name/email from User collection)
  let memberDetails;
  try {
    const memberUsers = await User.find({ userId: { $in: membersToAssign } })
      .select('userId email')
      .lean();
    const userMap = Object.fromEntries(memberUsers.map((u) => [u.userId, u]));
    memberDetails = assignedMembersData.map((m) => ({
      memberId: m.memberId,
      name: userMap[m.memberId]?.email ?? m.memberId,
      email: userMap[m.memberId]?.email ?? null,
      status: m.status,
    }));
  } catch (err) {
    console.error('[assignReview] user fetch error:', err.message);
    memberDetails = assignedMembersData.map((m) => ({
      memberId: m.memberId,
      name: m.memberId,
      email: null,
      status: m.status,
    }));
  }

  // Audit log (fire-and-forget)
  AuditLog.create({
    action: 'REVIEW_ASSIGNED',
    actorId: userId,
    targetId: review.reviewId,
    groupId: deliverable.groupId,
    payload: { reviewId: review.reviewId, deliverableId, assignedMemberCount: assignedMembersData.length },
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  }).catch((err) => console.error('[assignReview] audit log error:', err.message));

  // Dispatch notifications async (DFD f14: 6.1 → Notification Service); does not block response
  const notificationsSent = membersToAssign.length;
  setImmediate(async () => {
    try {
      await axios.post(
        `${NOTIFICATION_SERVICE_URL}/api/notifications`,
        {
          type: 'review_assignment',
          reviewId: review.reviewId,
          deliverableId,
          groupId: deliverable.groupId,
          recipients: membersToAssign,
          instructions: instructions || null,
        },
        { timeout: 5000 }
      );
    } catch (err) {
      console.error('[assignReview] notification dispatch error:', err.message);
    }
  });

  return res.status(201).json({
    deliverableId,
    reviewId: review.reviewId,
    assignedCommitteeMembers: memberDetails,
    assignedCount: memberDetails.length,
    deadline: review.deadline.toISOString(),
    notificationsSent,
    instructions: review.instructions,
  });
};

/**
 * GET /api/v1/reviews/status
 *
 * Process 6 — Return the current review record for a given deliverable.
 * Requires: JWT (coordinator role only). Query param: deliverableId.
 */
const getReviewStatus = async (req, res) => {
  const { deliverableId } = req.query;

  if (!deliverableId) {
    return res.status(400).json({ code: 'INVALID_REQUEST', message: 'deliverableId query parameter is required' });
  }

  let review;
  try {
    review = await Review.findOne({ deliverableId }).lean();
  } catch (err) {
    console.error('[getReviewStatus] DB error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Database query failed' });
  }

  if (!review) {
    return res.status(404).json({ code: 'REVIEW_NOT_FOUND', message: 'No review found for this deliverable' });
  }

  return res.status(200).json({
    reviewId: review.reviewId,
    deliverableId: review.deliverableId,
    groupId: review.groupId,
    status: review.status,
    assignedMembers: review.assignedMembers,
    deadline: review.deadline,
    instructions: review.instructions,
    createdAt: review.createdAt,
  });
};

module.exports = { updateCommentHandler, replyToCommentHandler, addComment, getComments, assignReview, getReviewStatus };
