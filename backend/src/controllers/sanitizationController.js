/**
 * ========================================
 * Issue #67, #69 & #70: Post-Deadline Sanitization & Notification Protocol
 * ========================================
 * Process 3.7: Disband unassigned groups, persist state, then report notification outcomes
 * (graceful degradation — DB work is authoritative; notification failures are surfaced).
 */

const {
  fetchUnassignedGroups,
  disbandGroupBatch,
  SanitizationServiceError,
  checkScheduleWindowDeadline,
} = require('../services/sanitizationService');
const { retryNotificationWithBackoff } = require('../utils/notificationRetry');
const { dispatchDisbandNotification } = require('../services/notificationService');
const Group = require('../models/Group');

/**
 * After groups are disbanded in D2, notify members; failures are collected, not elevated to 5xx.
 */
const collectDisbandNotificationFailures = async (disbandedGroupIds) => {
  const failures = [];
  for (const gid of disbandedGroupIds) {
    const group = await Group.findOne({ groupId: gid }).select('groupId groupName members leaderId').lean();
    if (!group) continue;

    const accepted = (group.members || [])
      .filter((m) => m.status === 'accepted')
      .map((m) => m.userId);
    const members = accepted.length > 0 ? accepted : (group.leaderId ? [group.leaderId] : []);
    if (members.length === 0) continue;

    const result = await retryNotificationWithBackoff(
      () =>
        dispatchDisbandNotification({
          type: 'disband_notice',
          groupId: group.groupId,
          groupName: group.groupName,
          members,
          reason: 'advisor_association_deadline_missed',
        }),
      {
        maxAttempts: 3,
        identifier: group.groupId,
        identifierType: 'groupId',
        initialBackoffMs: 200,
      }
    );

    if (!result.success) {
      failures.push({
        groupId: group.groupId,
        error: result.error?.message || 'notification_dispatch_failed',
      });
    }
  }
  return failures;
};

/**
 * POST /api/v1/groups/advisor-sanitization
 * Process 3.7: Main entry point for disbanding unassigned groups.
 */
const advisorSanitization = async (req, res) => {
  try {
    const { groupIds } = req.body;
    const coordinatorId = req.user?.id || req.user?.userId;

    if (groupIds !== undefined) {
      if (!Array.isArray(groupIds) || groupIds.length > 500) {
        return res.status(400).json({
          code: 'INVALID_INPUT',
          message: 'groupIds must be an array (max 500 items)',
        });
      }
    }

    const deadlineCheckResult = await checkScheduleWindowDeadline();
    if (!deadlineCheckResult.allowed) {
      return res.status(409).json({
        code: 'DEADLINE_NOT_REACHED',
        message: deadlineCheckResult.message,
        deadlineAt: deadlineCheckResult.deadlineAt,
      });
    }

    const unassignedGroups = await fetchUnassignedGroups(groupIds);

    if (unassignedGroups.length === 0) {
      return res.status(200).json({
        success: true,
        code: 'SANITIZATION_COMPLETE',
        count: 0,
        disbandedGroups: [],
        notificationFailures: [],
        checkedAt: new Date().toISOString(),
        message: 'No unassigned groups found for sanitization',
      });
    }

    const disbandResult = await disbandGroupBatch(unassignedGroups, coordinatorId, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'advisor_association_deadline_missed',
    });

    const notificationFailures = await collectDisbandNotificationFailures(disbandResult.disbanded_ids);

    return res.status(200).json({
      success: true,
      code: 'SANITIZATION_COMPLETE',
      count: disbandResult.disbanded_count,
      disbandedGroups: disbandResult.disbanded_ids,
      notificationFailures,
      checkedAt: new Date().toISOString(),
      message: `Sanitization complete: ${disbandResult.disbanded_count} group(s) disbanded`,
      details: {
        total_checked: unassignedGroups.length,
        errors: disbandResult.errors,
      },
    });
  } catch (err) {
    if (err instanceof SanitizationServiceError) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }

    console.error('[Advisor Sanitization] Unexpected error:', err);
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during sanitization',
    });
  }
};

module.exports = {
  advisorSanitization,
};
