'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #235 INTEGRATION: contributionRecalculateService.js
 * Process 7.3–7.5 Orchestration: Attribution → Ratio Calculation → Persistence
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * Orchestrates the full contribution calculation pipeline:
 *   1. Process 7.3: Map story points to students (attributionService)
 *   2. Process 7.4: Calculate contribution ratios (ratio engine)
 *   3. Process 7.5: Persist sprint records + notifications
 *
 * Called by:
 * POST /groups/{groupId}/sprints/{sprintId}/contributions/recalculate
 *
 * Input:
 *   - sprintId: Sprint to recalculate
 *   - groupId: Group context
 *   - overrideExisting: Replace existing records (default: true)
 *   - notifyStudents: Send notifications after completion (default: false)
 *
 * Output:
 *   - SprintContributionSummary with per-student ratios
 *   - Updated ContributionRecords in D6
 *   - Audit trail
 *
 * Key Integration Point for Issue #235:
 * - Calls attributionService.attributeStoryPoints() to populate storyPointsCompleted
 * - Passes results to ratio engine (Process 7.4)
 * - Handles edge cases (zero targets, locked sprints)
 */

const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');
const Group = require('../models/Group');
const { attributeStoryPoints } = require('./attributionService');
const { createAuditLog } = require('./auditService');

/**
 * When recalculating against a freshly bootstrapped sprint (or any sprint
 * that hasn't been touched by a Jira/GitHub sync yet) there are zero
 * ContributionRecord rows for the (groupId, sprintId) pair. The controller
 * then bails with 422 EMPTY_CONTRIBUTION_LIST, which breaks the chain of
 * recalculate → final-grade preview the demo flow needs. This helper
 * lazily seeds one empty row per accepted member so the rest of the
 * pipeline always has at least N>0 rows to work with.
 */
async function ensureContributionRowsForAcceptedMembers(sprintId, groupId) {
  const existing = await ContributionRecord.countDocuments({ sprintId, groupId });
  if (existing > 0) return { seeded: 0, alreadyExisting: existing };

  const group = await Group.findOne({ groupId }).select('members').lean();
  const acceptedMemberIds = (group?.members || [])
    .filter((member) => member && member.status === 'accepted' && member.userId)
    .map((member) => member.userId);
  if (acceptedMemberIds.length === 0) {
    return { seeded: 0, alreadyExisting: 0 };
  }

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
  const result = await ContributionRecord.bulkWrite(ops, { ordered: false });
  return {
    seeded: result.upsertedCount || 0,
    alreadyExisting: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class ContributionRecalculateError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ContributionRecalculateError';
    this.status = status;
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN RECALCULATION ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * recalculateSprintContributions(sprintId, groupId, options)
 *
 * ISSUE #235 INTEGRATION POINT: Calls attributionService for Process 7.3
 *
 * Process Flow:
 * 1. Validate sprint not locked
 * 2. ISSUE #235: Call attributionService.attributeStoryPoints()
 *    - Maps merged PR authors to students
 *    - Validates group membership
 *    - Populates storyPointsCompleted in ContributionRecords
 * 3. PROCESS 7.4: Calculate contribution ratios from story points
 * 4. PROCESS 7.5: Persist records + emit notifications
 *
 * @param {string} sprintId - Sprint ID
 * @param {string} groupId - Group ID
 * @param {object} options - Recalculation options
 *   - overrideExisting: boolean (default: true)
 *   - notifyStudents: boolean (default: false)
 *   - useJiraFallback: boolean (default: false) - for attributionService
 *
 * @returns {Promise<object>} SprintContributionSummary
 * @throws {ContributionRecalculateError} if sprint locked, invalid group, etc.
 */
async function recalculateSprintContributions(sprintId, groupId, options = {}) {
  const {
    overrideExisting = true,
    notifyStudents = false,
    enable_assignee_fallback = false,
    useJiraFallback = false,
  } = options;

  try {
    console.log(
      `[recalculateSprintContributions] ISSUE #235 INTEGRATION: Recalculating ${sprintId}/${groupId}`
    );

    // ───────────────────────────────────────────────────────────────────────────
    // VALIDATION: Check sprint exists and is not locked
    // ───────────────────────────────────────────────────────────────────────────

    const sprintRecord = await SprintRecord.findOne({ sprintId, groupId });
    if (!sprintRecord) {
      console.error(`[recalculateSprintContributions] Sprint ${sprintId} not found`);
      throw new ContributionRecalculateError(
        404,
        'SPRINT_NOT_FOUND',
        `Sprint ${sprintId} not found in group ${groupId}`
      );
    }

    // ISSUE #235 NOTE: If sprint is locked/finalized, prevent recalculation
    // (This constraint would be added if D8 had a 'lockedAt' field)
    if (sprintRecord.locked) {
      throw new ContributionRecalculateError(
        409,
        'SPRINT_LOCKED',
        'Cannot recalculate contributions for a locked sprint'
      );
    }

    // ───────────────────────────────────────────────────────────────────────────
    // STEP 1: ISSUE #235 — Attribution (Process 7.3)
    // ───────────────────────────────────────────────────────────────────────────
    // CRITICAL: Call attributionService to map GitHub authors to students
    //
    // This is the core of Issue #235:
    //   - Reads merged PR data from D6 (GitHub sync job)
    //   - Maps to studentId via D1 (GitHub username)
    //   - Validates D2 group membership
    //   - Populates storyPointsCompleted in ContributionRecords
    //
    // Returns attribution summary with:
    //   - Per-student completed points
    //   - Unattributable metrics
    //   - Warnings (for operational dashboards)

    console.log(`[recalculateSprintContributions] STEP 1: Calling attributionService for Process 7.3`);

    const attributionResult = await attributeStoryPoints(sprintId, groupId, {
      enable_assignee_fallback: enable_assignee_fallback === true || useJiraFallback === true,
      overrideExisting,
    });

    console.log(
      `[recalculateSprintContributions] ATTRIBUTION RESULT: ${attributionResult.attributedStudents} students, ${attributionResult.totalStoryPoints} SP`
    );

    // ───────────────────────────────────────────────────────────────────────────
    // STEP 2: PROCESS 7.4 — Ratio Calculation
    // ───────────────────────────────────────────────────────────────────────────
    // ISSUE #235 OUTPUT: Use storyPointsCompleted for ratio calculation
    //
    // Now that storyPointsCompleted is populated (from Issue #235), we calculate:
    //   - contributionRatio = storyPointsCompleted / targetStoryPoints
    //   - Group normalization (if configured)
    //
    // TODO: Implement ratio engine in Process 7.4
    // For now, we assume a basic ratio calculation.

    console.log(`[recalculateSprintContributions] STEP 2: Calculating contribution ratios`);

    // Defensive backfill: a freshly bootstrapped sprint has no
    // ContributionRecord rows yet. Seed one zeroed row per accepted member
    // so we never return 422 EMPTY_CONTRIBUTION_LIST on the "minimum data
    // set" path that the demo / coordinator preview flow relies on.
    const seedResult = await ensureContributionRowsForAcceptedMembers(sprintId, groupId);
    if (seedResult.seeded > 0) {
      console.log(
        `[recalculateSprintContributions] Seeded ${seedResult.seeded} empty contribution rows for accepted members (sprint had no prior records).`
      );
    }

    const contributionRecords = await ContributionRecord.find({
      sprintId,
      groupId,
    });

    // ISSUE #235 NOTE: At this point, storyPointsCompleted should be populated
    // by attributionService (from Step 1). We just need to calculate ratios.

    const ratioCalculations = [];
    const ratioBulkOps = [];
    for (const record of contributionRecords) {
      const targetPoints = record.targetStoryPoints;
      const ratio = targetPoints > 0 ? record.storyPointsCompleted / targetPoints : 0;

      const contributionRatio = Math.min(ratio, 1.0); // Clamp to [0, 1]
      ratioBulkOps.push({
        updateOne: {
          filter: { _id: record._id },
          update: {
            $set: {
              contributionRatio,
              lastUpdatedAt: new Date(),
            },
          },
        },
      });

      ratioCalculations.push({
        studentId: record.studentId,
        completedPoints: record.storyPointsCompleted,
        targetPoints,
        ratio: contributionRatio,
      });

      console.log(
        `[recalculateSprintContributions] Ratio: student ${record.studentId} = ${record.storyPointsCompleted}/${targetPoints} = ${contributionRatio}`
      );
    }

    if (ratioBulkOps.length > 0) {
      await ContributionRecord.bulkWrite(ratioBulkOps, { ordered: false });
    }

    // ───────────────────────────────────────────────────────────────────────────
    // STEP 3: PROCESS 7.5 — Audit Logging
    // ───────────────────────────────────────────────────────────────────────────
    // ISSUE #235 AUDITABILITY: Log the complete recalculation

    try {
      await createAuditLog({
        action: 'SPRINT_CONTRIBUTIONS_RECALCULATED',
        actorId: 'system',
        targetId: sprintId,
        groupId,
        payload: {
          sprintId,
          groupId,
          attributionSummary: {
            attributedStudents: attributionResult.attributedStudents,
            totalStoryPoints: attributionResult.totalStoryPoints,
            unattributablePoints: attributionResult.unattributablePoints,
            unattributableCount: attributionResult.unattributableCount,
          },
          warnings: attributionResult.warnings,
          unattributableDetails: attributionResult.unattributableDetails,
          recalculatedAt: new Date(),
        },
      });
    } catch (auditErr) {
      console.error('[recalculateSprintContributions] Audit log failed (non-fatal):', auditErr.message);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // BUILD RESPONSE SUMMARY
    // ───────────────────────────────────────────────────────────────────────────

    const summary = {
      sprintId,
      groupId,
      success: true,
      recalculatedAt: new Date(),
      
      // ISSUE #235: Attribution summary
      attribution: {
        attributedStudents: attributionResult.attributedStudents,
        totalStoryPoints: attributionResult.totalStoryPoints,
        unattributablePoints: attributionResult.unattributablePoints,
        unattributableCount: attributionResult.unattributableCount,
        unattributableDetails: attributionResult.unattributableDetails,
        warnings: attributionResult.warnings,
      },

      // Process 7.4: Ratio calculations
      contributions: ratioCalculations.map((rc) => ({
        studentId: rc.studentId,
        completedPoints: rc.completedPoints,
        targetPoints: rc.targetPoints,
        contributionRatio: rc.ratio,
      })),

      // Metrics
      metrics: {
        totalRecords: contributionRecords.length,
        averageRatio: ratioCalculations.length > 0
          ? (ratioCalculations.reduce((sum, rc) => sum + rc.ratio, 0) / ratioCalculations.length)
          : 0,
      },
    };

    console.log(`[recalculateSprintContributions] COMPLETE: Summary returned`);

    return summary;
  } catch (err) {
    console.error('[recalculateSprintContributions] FATAL ERROR:', err);
    if (err instanceof ContributionRecalculateError) throw err;
    throw new ContributionRecalculateError(
      500,
      'RECALCULATE_FAILED',
      `Failed to recalculate contributions: ${err.message}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  recalculateSprintContributions,
  ContributionRecalculateError,
};
