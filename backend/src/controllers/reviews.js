'use strict';

const Review = require('../models/Review');
const Deliverable = require('../models/Deliverable');
const Comment = require('../models/Comment');
const Committee = require('../models/Committee');
const AuditLog = require('../models/AuditLog');
const { dispatchReviewAssignmentNotification } = require('../services/notificationService');

/**
 * POST /api/v1/reviews/assign
 * Assign a review to a deliverable with specific committee members
 */
exports.assignReview = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { deliverableId, selectedCommitteeMembers, reviewDeadlineDays, instructions } = req.body;

    // Validate required fields
    if (!deliverableId) {
      return res.status(400).json({ message: 'deliverableId is required' });
    }

    if (reviewDeadlineDays === undefined || reviewDeadlineDays === null) {
      return res.status(400).json({ message: 'reviewDeadlineDays is required' });
    }

    if (reviewDeadlineDays <= 0) {
      return res.status(400).json({ message: 'reviewDeadlineDays must be greater than 0' });
    }

    // Get deliverable
    const deliverable = await Deliverable.findOne({ deliverableId }).lean();
    if (!deliverable) {
      return res.status(404).json({ message: 'Deliverable not found' });
    }

    // Check if review already exists (before status check so 409 takes precedence)
    const existingReview = await Review.findOne({ deliverableId }).lean();
    if (existingReview) {
      return res.status(409).json({
        message: 'Review already exists for this deliverable',
      });
    }

    // Check deliverable status
    if (deliverable.status !== 'accepted') {
      return res.status(400).json({
        message: `Deliverable must be in 'accepted' status, current status: ${deliverable.status}`,
      });
    }

    // Get committee to validate members
    const committee = await Committee.findOne({ committeeId: deliverable.committeeId }).lean();
    if (!committee) {
      return res.status(400).json({ message: 'Committee not found' });
    }

    // Determine which members to assign
    const membersToAssign = selectedCommitteeMembers || committee.advisorIds;

    // Validate member IDs
    const invalidMemberIds = membersToAssign.filter(
      (id) => !committee.advisorIds.includes(id)
    );

    if (invalidMemberIds.length > 0) {
      return res.status(400).json({
        message: 'Some member IDs are not valid committee members',
        invalidMemberIds,
      });
    }

    // Create review
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + reviewDeadlineDays);

    const assignedMembers = membersToAssign.map((memberId) => ({
      memberId,
      status: 'notified',
    }));

    const review = await Review.create({
      deliverableId,
      groupId: deliverable.groupId,
      status: 'pending',
      assignedMembers,
      deadline,
      instructions: instructions || null,
    });

    // Update deliverable status to under_review
    await Deliverable.findOneAndUpdate(
      { deliverableId },
      { status: 'under_review' },
      { new: true }
    );

    // Create audit log
    await AuditLog.create({
      action: 'REVIEW_ASSIGNED',
      actorId: userId,
      payload: {
        reviewId: review.reviewId,
        deliverableId,
        groupId: deliverable.groupId,
        assignedMemberCount: assignedMembers.length,
      },
    });

    // Dispatch notifications
    try {
      await dispatchReviewAssignmentNotification({
        reviewId: review.reviewId,
        deliverableId,
        membersToNotify: assignedMembers.map((m) => m.memberId),
        instructions,
      });
    } catch (notificationError) {
      console.error('Notification dispatch error:', notificationError);
      // Don't fail the request if notification fails
    }

    res.status(201).json({
      reviewId: review.reviewId,
      deliverableId,
      groupId: review.groupId,
      status: review.status,
      assignedMembers: review.assignedMembers,
      deadline: review.deadline,
      instructions: review.instructions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/reviews/status
 * Process 6.3 — Coordinator dashboard: live overview of all reviews.
 * Query params: status (pending|in_progress|needs_clarification|completed), page (default 1)
 */
exports.getReviewStatus = async (req, res, next) => {
  try {
    const { status, page = '1' } = req.query;

    const VALID_REVIEW_STATUSES = ['pending', 'in_progress', 'needs_clarification', 'completed'];

    if (status && !VALID_REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${VALID_REVIEW_STATUSES.join(', ')}`,
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const PAGE_SIZE = 20;
    const skip = (pageNum - 1) * PAGE_SIZE;
    const filter = status ? { status } : {};

    const [statusCounts, total, reviews] = await Promise.all([
      Review.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Review.countDocuments(filter),
      Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
    ]);

    const statuses = { pending: 0, in_progress: 0, needs_clarification: 0, completed: 0 };
    for (const { _id, count } of statusCounts) {
      if (_id in statuses) statuses[_id] = count;
    }

    if (reviews.length === 0) {
      return res.status(200).json({ total, statuses, reviews: [] });
    }

    const deliverableIds = reviews.map((r) => r.deliverableId);

    const [deliverables, commentCounts, clarificationCounts] = await Promise.all([
      Deliverable.find({ deliverableId: { $in: deliverableIds } })
        .select('deliverableId deliverableType sprintId')
        .lean(),
      Comment.aggregate([
        { $match: { deliverableId: { $in: deliverableIds } } },
        { $group: { _id: '$deliverableId', count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        {
          $match: {
            deliverableId: { $in: deliverableIds },
            needsResponse: true,
            status: 'open',
          },
        },
        { $group: { _id: '$deliverableId', count: { $sum: 1 } } },
      ]),
    ]);

    const deliverableMap = Object.fromEntries(deliverables.map((d) => [d.deliverableId, d]));
    const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c._id, c.count]));
    const clarificationCountMap = Object.fromEntries(
      clarificationCounts.map((c) => [c._id, c.count])
    );

    const reviewList = reviews.map((r) => {
      const del = deliverableMap[r.deliverableId] || {};
      return {
        deliverableId: r.deliverableId,
        groupId: r.groupId,
        deliverableType: del.deliverableType || null,
        sprintId: del.sprintId || null,
        reviewStatus: r.status,
        commentCount: commentCountMap[r.deliverableId] || 0,
        clarificationsRemaining: clarificationCountMap[r.deliverableId] || 0,
        deadline: r.deadline,
      };
    });

    return res.status(200).json({ total, statuses, reviews: reviewList });
  } catch (error) {
    next(error);
  }
};
