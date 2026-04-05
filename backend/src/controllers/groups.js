const Group = require('../models/Group');
const ApprovalQueue = require('../models/ApprovalQueue');
const GroupMembership = require('../models/GroupMembership');

const VALID_DECISIONS = new Set(['approved', 'rejected']);

/**
 * POST /groups/:groupId/approval-results
 *
 * Forwards approval results from process 2.4 to the 2.5 processing queue
 * (DFD flow f09: 2.4 → 2.5). Approved decisions trigger D2 member record
 * updates. Duplicate forwarding of the same notification_id is idempotent.
 */
const forwardApprovalResults = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { notification_id, results } = req.body;

    if (!notification_id || typeof notification_id !== 'string' || !notification_id.trim()) {
      return res.status(400).json({
        code: 'MISSING_NOTIFICATION_ID',
        message: 'notification_id is required',
      });
    }

    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({
        code: 'EMPTY_RESULTS',
        message: 'results must be a non-empty array',
      });
    }

    // Validate each result entry
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.student_id || typeof r.student_id !== 'string') {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].student_id is required`,
        });
      }
      if (!r.decision || !VALID_DECISIONS.has(r.decision)) {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].decision must be 'approved' or 'rejected'`,
        });
      }
      if (!r.decided_by || typeof r.decided_by !== 'string') {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].decided_by is required`,
        });
      }
      if (!r.decided_at || isNaN(new Date(r.decided_at).getTime())) {
        return res.status(400).json({
          code: 'INVALID_RESULT',
          message: `results[${i}].decided_at must be a valid date`,
        });
      }
    }

    // Validate group exists
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const processedAt = new Date();
    const newlyQueued = [];

    for (const result of results) {
      const { student_id, decision, decided_by, decided_at } = result;

      // Idempotency check: skip if already forwarded for this (notification, group, student)
      const existing = await ApprovalQueue.findOne({
        notificationId: notification_id,
        groupId,
        studentId: student_id,
      });

      if (existing) {
        continue;
      }

      // Enqueue for process 2.5
      const queueEntry = await ApprovalQueue.create({
        groupId,
        notificationId: notification_id,
        studentId: student_id,
        decision,
        decidedBy: decided_by,
        decidedAt: new Date(decided_at),
        status: 'pending',
      });

      newlyQueued.push(queueEntry);

      // Process 2.5: update D2 member record for approved decisions
      if (decision === 'approved') {
        await GroupMembership.findOneAndUpdate(
          { groupId, studentId: student_id },
          {
            $set: {
              status: 'approved',
              decidedBy: decided_by,
              decidedAt: new Date(decided_at),
            },
            $setOnInsert: {
              membershipId: `mem_${require('uuid').v4().split('-')[0]}`,
            },
          },
          { upsert: true, new: true }
        );
      }

      // Mark queue entry as processed
      queueEntry.status = 'processed';
      queueEntry.processedAt = processedAt;
      await queueEntry.save();
    }

    return res.status(200).json({
      forwarded_count: newlyQueued.length,
      queued_request_ids: newlyQueued.map((q) => q.queueId),
      processed_at: processedAt.toISOString(),
    });
  } catch (err) {
    console.error('forwardApprovalResults error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
};

module.exports = { forwardApprovalResults };
