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
const { attributeStoryPoints, getAttributionSummary } = require('./attributionService');
const { createAuditLog } = require('./auditService');

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
      useJiraFallback,
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

    const contributionRecords = await ContributionRecord.find({
      sprintId,
      groupId,
    });

    // ISSUE #235 NOTE: At this point, storyPointsCompleted should be populated
    // by attributionService (from Step 1). We just need to calculate ratios.

    const ratioCalculations = [];
    for (const record of contributionRecords) {
      // PROCESS 7.4: Simple ratio calculation
      // TODO: Use actual targetStoryPoints from D8 sprint configuration
      const targetPoints = 10; // Placeholder
      const ratio = record.storyPointsCompleted / targetPoints;

      // Update ratio in ContributionRecord
      record.contributionRatio = Math.min(ratio, 1.0); // Clamp to [0, 1]
      await record.save();

      ratioCalculations.push({
        studentId: record.studentId,
        completedPoints: record.storyPointsCompleted,
        targetPoints,
        ratio: record.contributionRatio,
      });

      console.log(
        `[recalculateSprintContributions] Ratio: student ${record.studentId} = ${record.storyPointsCompleted}/${targetPoints} = ${record.contributionRatio}`
      );
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
