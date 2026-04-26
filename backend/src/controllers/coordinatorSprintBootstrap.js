'use strict';

/**
 * Coordinator-only "empty sprint" bootstrap.
 *
 * In a stock dev/demo environment Sprint records normally only appear as a
 * side-effect of a successful Jira/GitHub sync. When the org has no Jira/
 * GitHub credentials wired up the chain breaks: no SprintRecord -> empty
 * sprint dropdown -> can't assign deliverables / recalculate / preview
 * grades. This endpoint lets a coordinator (or admin) seed a single empty
 * SprintRecord row for a group on demand.
 *
 * The created record uses the same shape as the seed-test-general fixture:
 * status='pending', no committee, no deliverable refs. It can later be
 * reused by the regular sync flow (which upserts on {groupId, sprintId}).
 */

const SprintRecord = require('../models/SprintRecord');
const Group = require('../models/Group');
const ContributionRecord = require('../models/ContributionRecord');
const { createAuditLog } = require('../services/auditService');

const VALID_STATUSES = ['pending', 'in_progress', 'submitted', 'reviewed', 'completed'];
const SPRINT_ID_RE = /^[A-Za-z0-9._-]+$/;

const slugifySprintId = (raw) => String(raw || '').trim();

const bootstrapSprint = async (req, res) => {
  try {
    const { groupId } = req.params;
    const body = req.body || {};
    const requestedSprintId = slugifySprintId(body.sprintId);
    const requestedStatus = body.status ? String(body.status).trim() : 'pending';
    const committeeId = body.committeeId ? String(body.committeeId).trim() : null;

    if (!groupId) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'groupId is required.' });
    }

    if (requestedStatus && !VALID_STATUSES.includes(requestedStatus)) {
      return res.status(400).json({
        code: 'INVALID_STATUS',
        message: `status must be one of ${VALID_STATUSES.join(', ')}.`,
      });
    }

    if (requestedSprintId && !SPRINT_ID_RE.test(requestedSprintId)) {
      return res.status(400).json({
        code: 'INVALID_SPRINT_ID',
        message: 'sprintId may only contain letters, digits, dot, dash and underscore.',
      });
    }

    const group = await Group.findOne({ groupId }).select('groupId groupName members').lean();
    if (!group) {
      return res.status(404).json({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found.`,
      });
    }

    const acceptedMemberIds = (group.members || [])
      .filter((member) => member && member.status === 'accepted' && member.userId)
      .map((member) => member.userId);

    let sprintId = requestedSprintId;
    if (!sprintId) {
      // Auto-pick a non-colliding bootstrap id like "bootstrap-sprint-1".
      const existingCount = await SprintRecord.countDocuments({ groupId });
      let candidate;
      // Cap iterations to avoid an unbounded loop in pathological cases.
      for (let i = existingCount + 1; i < existingCount + 1 + 50; i += 1) {
        candidate = `bootstrap-sprint-${i}`;
        // eslint-disable-next-line no-await-in-loop
        const collision = await SprintRecord.findOne({ groupId, sprintId: candidate })
          .select('sprintId')
          .lean();
        if (!collision) {
          break;
        }
        candidate = null;
      }
      if (!candidate) {
        return res.status(409).json({
          code: 'SPRINT_ID_GENERATION_FAILED',
          message: 'Could not generate a free sprint id automatically; pass one explicitly.',
        });
      }
      sprintId = candidate;
    } else {
      const existing = await SprintRecord.findOne({ groupId, sprintId })
        .select('sprintRecordId sprintId status')
        .lean();
      if (existing) {
        return res.status(409).json({
          code: 'SPRINT_ALREADY_EXISTS',
          message: `Sprint ${sprintId} already exists for group ${groupId}.`,
          existing,
        });
      }
    }

    const created = await SprintRecord.create({
      sprintId,
      groupId,
      committeeId,
      committeeAssignedAt: committeeId ? new Date() : null,
      status: requestedStatus,
      deliverableRefs: [],
    });

    // Seed one empty ContributionRecord per accepted member so a follow-up
    // recalculate (which expects at least one row) doesn't bail with 422
    // EMPTY_CONTRIBUTION_LIST. Use upsert in case rows already exist for
    // this (sprintId, groupId, studentId) triple from a prior partial run.
    let contributionsSeeded = 0;
    if (acceptedMemberIds.length > 0) {
      const ops = acceptedMemberIds.map((studentId) => ({
        updateOne: {
          filter: { sprintId, groupId, studentId },
          update: {
            $setOnInsert: {
              sprintId,
              groupId,
              studentId,
              storyPointsAssigned: 0,
              storyPointsCompleted: 0,
              contributionRatio: 0,
              targetStoryPoints: 0,
              groupTotalStoryPoints: 0,
              jiraIssueKeys: [],
              jiraIssueKey: null,
              githubHandle: null,
              lastUpdatedAt: new Date(),
            },
          },
          upsert: true,
        },
      }));
      const bulkResult = await ContributionRecord.bulkWrite(ops, { ordered: false });
      contributionsSeeded =
        (bulkResult.upsertedCount || 0) +
        (bulkResult.modifiedCount || 0);
    }

    await createAuditLog({
      action: 'sprint_bootstrap_created',
      actorId: req.user?.userId,
      targetId: created.sprintRecordId,
      groupId,
      payload: {
        groupId,
        sprintId: created.sprintId,
        sprintRecordId: created.sprintRecordId,
        status: created.status,
        committeeId,
      },
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent'),
    }).catch(() => {});

    return res.status(201).json({
      sprintRecordId: created.sprintRecordId,
      sprintId: created.sprintId,
      groupId: created.groupId,
      status: created.status,
      committeeId: created.committeeId,
      createdAt: created.createdAt,
      acceptedMemberCount: acceptedMemberIds.length,
      contributionsSeeded,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        code: 'SPRINT_ALREADY_EXISTS',
        message: 'A sprint with that id already exists for this group.',
      });
    }
    console.error('bootstrapSprint error:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to bootstrap sprint record.',
    });
  }
};

module.exports = {
  bootstrapSprint,
};
