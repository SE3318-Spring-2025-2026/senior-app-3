/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ISSUE #236 SERVICE: contributionRatioService.js
 * Main Contribution Ratio Engine for Process 7.4 (Ratio Calculation)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * Core service orchestrating the 10-step Process 7.4 ratio calculation pipeline:
 * 1. Input validation (coordinator auth, sprint/group existence)
 * 2. Sprint lock check (Criterion #3: locked → 409)
 * 3. Fetch all group members and their Issue #235 contributions
 * 4. Load D8 target configuration (or use fallback)
 * 5. Calculate group total story points
 * 6. Compute per-student ratio using strategy
 * 7. Apply rounding/normalization policy
 * 8. Atomic MongoDB transaction (Criterion #5: idempotent)
 * 9. Update recalculatedAt timestamp
 * 10. Return detailed summary + audit entry
 *
 * DFD Integration:
 * - INPUT: f7_p73_p74 (storyPointsCompleted from Issue #235)
 * - INPUT: f7_ds_d8_p74 (targetStoryPoints from D8 SprintTarget)
 * - OUTPUT: f7_p74_p75 (contributionRatio to Process 7.5)
 * - OUTPUT: f7_p74_p80_external (ratios for grading/analytics)
 *
 * Error Codes (SCREAMING_SNAKE_CASE):
 * - NOT_FOUND: Sprint or group doesn't exist
 * - SPRINT_LOCKED: Sprint is locked (Criterion #3)
 * - ZERO_GROUP_TOTAL: No contributions in group (422 → "Invalid State")
 * - MISSING_TARGETS: No D8 configuration (handled by fallback)
 * - CALCULATION_ERROR: NaN or Infinity in ratio (500 error)
 * - ATOMIC_WRITE_FAILED: Transaction failed (500 error)
 */

const mongoose = require('mongoose');
const ContributionRecord = require('../models/ContributionRecord');
const SprintRecord = require('../models/SprintRecord');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');
const ratioNormalization = require('../utils/ratioNormalization');

/**
 * ISSUE #236 CUSTOM ERROR: RatioServiceError
 * Extends standard error with HTTP status and error code
 * Pattern: Consistent with d6UpdateServiceError, githubSyncServiceError
 */
class RatioServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'RatioServiceError';
    this.status = status;
    this.code = code;
    this.timestamp = new Date();
  }
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 1 - Input Validation
 * Verify sprint exists, is in group, and user is coordinator
 *
 * @param {string} groupId - MongoDB ObjectId of group
 * @param {string} sprintId - MongoDB ObjectId of sprint
 * @param {string} userId - ID of requesting user (for audit)
 * @returns {Promise<{group, sprint}>} Validated objects
 * @throws {RatioServiceError} 404 NOT_FOUND or 403 UNAUTHORIZED
 */
async function validateInputs(groupId, sprintId, userId) {
  // ISSUE #236 STEP 1: Input validation
  // Why: Prevent orphaned calculations
  // What: Check sprint exists and belongs to group

  const sprint = await SprintRecord.findOne({
    sprintRecordId: sprintId,
    groupId: groupId
  });

  if (!sprint) {
    throw new RatioServiceError(404, 'NOT_FOUND', `Sprint ${sprintId} not found in group ${groupId}`);
  }

  // ISSUE #236: Verify user authorization
  // Why: Only coordinators should recalculate ratios (business rule)
  // What: Check GroupMembership for coordinator role
  const membership = await GroupMembership.findOne({
    groupId: groupId,
    userId: userId,
    role: 'coordinator'
  });

  if (!membership) {
    throw new RatioServiceError(403, 'UNAUTHORIZED', 'User must be group coordinator to recalculate ratios');
  }

  return { sprint };
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 2 - Lock Status Check
 * Verify sprint is not locked (Acceptance Criterion #3)
 *
 * @param {Object} sprint - SprintRecord document
 * @returns {boolean} true if not locked (can proceed)
 * @throws {RatioServiceError} 409 CONFLICT if locked
 *
 * Lock Semantics:
 * - locked=true means sprint past submission deadline
 * - Ratios cannot be recalculated for locked sprints (prevent retroactive changes)
 * - Caller should return 409 Conflict to frontend
 */
function checkSprintNotLocked(sprint) {
  // ISSUE #236: Lock check (Acceptance Criterion #3)
  // Why: Prevent ratio changes after sprint deadline
  // What: Check ContributionRecord.locked field
  // Design: Each record has independent lock flag (student-level granularity)
  // Note: This function checks SPRINT-LEVEL metadata (future: per-student lock?)

  if (sprint.status === 'locked' || sprint.locked === true) {
    throw new RatioServiceError(
      409,
      'SPRINT_LOCKED',
      `Cannot recalculate ratios for locked sprint ${sprint.sprintRecordId}. Past deadline.`
    );
  }

  return true;
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 3 - Fetch Group Members & Their Contributions
 * Query all approved members + their Issue #235 ContributionRecords
 *
 * @param {string} groupId - MongoDB ObjectId
 * @param {string} sprintId - MongoDB ObjectId
 * @returns {Promise<Array>} Array of {member, contribution} objects
 *
 * Output Structure:
 * [
 *   {
 *     studentId: "user123",
 *     storyPointsCompleted: 13,  // From Issue #235
 *     storyPointsAssigned: 14,   // Baseline from JIRA
 *     githubHandle: "student-gh",
 *     existing record or null
 *   },
 *   ...
 * ]
 */
async function fetchGroupContributions(groupId, sprintId) {
  // ISSUE #236 STEP 3: Fetch all group members
  // Why: Need all members to calculate group total and per-student ratio
  // What: Query GroupMembership for approved members, then get their contributions

  const members = await GroupMembership.find({
    groupId: groupId,
    approvalStatus: 'approved'  // Only approved members count
  });

  if (members.length === 0) {
    throw new RatioServiceError(422, 'NO_MEMBERS', `No approved members in group ${groupId}`);
  }

  // ISSUE #236 STEP 3b: Fetch contributions for each member
  // Why: Need Issue #235 storyPointsCompleted for each student
  // What: Batch query all ContributionRecords for this sprint+group
  const memberIds = members.map(m => m.userId);
  
  const contributions = await ContributionRecord.find({
    sprintId: sprintId,
    groupId: groupId,
    studentId: { $in: memberIds }
  });

  // ISSUE #236: Build member contribution map
  // Why: Correlate members with their contribution records
  // What: Create lookup map for fast access
  const contributionMap = {};
  contributions.forEach(c => {
    contributionMap[c.studentId] = c;
  });

  // ISSUE #236: Return full member list with contributions
  // Why: Some members may not have contribution records yet (edge case)
  // What: Include null contribution for members without records
  const memberContributions = members.map(member => ({
    studentId: member.userId,
    storyPointsCompleted: contributionMap[member.userId]?.storyPointsCompleted || 0,
    storyPointsAssigned: contributionMap[member.userId]?.storyPointsAssigned || 0,
    githubHandle: contributionMap[member.userId]?.gitHubHandle || 'unknown',
    existingRecord: contributionMap[member.userId] || null
  }));

  return { members, contributions: memberContributions };
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 4-5 - Load Targets & Calculate Group Total
 *
 * @param {string} groupId
 * @param {string} sprintId
 * @param {Array} memberContributions - From STEP 3
 * @returns {Promise<{targets, groupTotal, strategy}>}
 *
 * Targets Loading Strategy:
 * 1. Try to load D8 SprintTarget configuration
 * 2. If missing: Use calculated average (Issue #235 Criterion #2)
 * 3. If still no data: Return null → signal fallback in ratio calc
 */
async function loadTargetsAndCalculateTotal(groupId, sprintId, memberContributions) {
  // ISSUE #236 STEP 4: Load D8 targets
  // Why: Ratio = completed / target (target from D8 configuration)
  // What: Query SprintTarget model for targets (or use fallback)
  // Note: SprintTarget might not exist if D8 not configured
  
  const sprintTargets = await SprintTarget.find({
    sprintId: sprintId,
    groupId: groupId
  }).catch(err => {
    // Model might not exist or DB query failed
    console.warn('[contributionRatioService] SprintTarget query failed, using fallback', err.message);
    return [];
  });

  // ISSUE #236: Calculate targets map
  // Why: Fast lookup for per-student targets
  const targetsMap = {};
  sprintTargets.forEach(t => {
    targetsMap[t.studentId] = t.targetStoryPoints;
  });

  // ISSUE #236 STEP 5: Calculate group total
  // Why: Used for 'weighted' strategy and group statistics
  // What: Sum all completed story points across group
  const groupTotal = memberContributions.reduce((sum, c) => sum + c.storyPointsCompleted, 0);

  // ISSUE #236: Guard against zero group total
  // Why: Acceptance Criterion #2 - cannot calculate meaningful ratio
  // What: Throw 422 if group total is 0 (invalid state)
  if (groupTotal <= 0) {
    throw new RatioServiceError(
      422,
      'ZERO_GROUP_TOTAL',
      `Group ${groupId} has zero completed story points. Cannot calculate ratios.`
    );
  }

  // ISSUE #236: Determine ratio strategy
  // Why: Different strategies for different grading scenarios
  // Default: 'fixed' (each student ratio independent)
  const strategy = 'fixed';  // TODO: Load from SprintConfig/D8 later

  return {
    targets: targetsMap,
    groupTotal: groupTotal,
    strategy: strategy,
    memberCount: memberContributions.length
  };
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 6 - Calculate Per-Student Ratios
 *
 * @param {Array} memberContributions - From STEP 3
 * @param {Object} targets - From STEP 4
 * @param {number} groupTotal - From STEP 5
 * @param {string} strategy - 'fixed', 'weighted', 'normalized'
 * @returns {Array} [{studentId, ratio, targetUsed, strategy}, ...]
 *
 * Ratio Calculation:
 * - If target > 0: ratio = completed / target
 * - If target <= 0: ratio = fallback (completed / groupAverage)
 * - If all zero: throw 422
 */
async function calculatePerStudentRatios(memberContributions, targets, groupTotal, strategy) {
  // ISSUE #236 STEP 6: Compute ratios
  // Why: Core calculation step
  // What: For each student, use ratioNormalization to compute ratio

  const ratios = memberContributions.map(contribution => {
    const { studentId, storyPointsCompleted } = contribution;

    // ISSUE #236: Get target for this student
    // Why: Different students may have different targets
    const target = targets[studentId] || null;

    // ISSUE #236: Compute ratio using utility (handles strategy + safety guards)
    // Why: Utility provides NaN/Infinity prevention
    let ratio = ratioNormalization.normalizeRatio(
      storyPointsCompleted,
      target || 1,  // Fallback target if missing
      groupTotal,
      strategy
    );

    // ISSUE #236: Fallback if target was missing
    // Why: Acceptance Criterion #2 - graceful handling of missing D8 targets
    // What: Use average target (groupTotal / memberCount)
    if (ratio === null) {
      const averageTarget = groupTotal / memberContributions.length;
      ratio = ratioNormalization.calculateFallbackRatio(
        storyPointsCompleted,
        groupTotal,
        memberContributions.length
      );
      
      console.info('[contributionRatioService] Using fallback ratio for student', {
        studentId,
        averageTarget,
        ratio,
        completed: storyPointsCompleted
      });
    }

    // ISSUE #236: Format ratio to 4 decimal places
    // Why: Precision policy (Numeric Precision DP-4)
    const formattedRatio = ratioNormalization.formatRatio(ratio, 4);

    // ISSUE #236: Guard against calculation errors
    // Why: Prevent NaN or Infinity in stored data
    if (!Number.isFinite(formattedRatio)) {
      throw new RatioServiceError(
        500,
        'CALCULATION_ERROR',
        `Failed to calculate ratio for student ${studentId}: got ${formattedRatio}`
      );
    }

    return {
      studentId: studentId,
      ratio: formattedRatio,
      targetUsed: target || averageTarget || 1,
      strategy: strategy,
      completed: storyPointsCompleted
    };
  });

  return ratios;
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 7-8 - Atomic Update & Persistence
 * Write all ratios to MongoDB in single transaction (Acceptance Criterion #5)
 *
 * @param {string} groupId
 * @param {string} sprintId
 * @param {Array} ratios - From STEP 6
 * @returns {Promise<{updated: number, timestamp}>}
 *
 * Atomicity Guarantee:
 * - All ratios updated together or none (transaction)
 * - Idempotent: same input always produces same DB state
 * - Prevents partial updates (race condition safety)
 */
async function atomicallyUpdateRatios(groupId, sprintId, ratios) {
  // ISSUE #236 STEP 7-8: Atomic transaction
  // Why: Acceptance Criterion #5 - ensure atomic all-or-nothing
  // What: Use MongoDB session + transaction
  // Design: If any update fails, entire transaction rolls back

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ISSUE #236: Update all ContributionRecords with new ratios
    // Why: Atomic batch operation
    // What: For each ratio, update the corresponding record
    let updateCount = 0;

    for (const ratio of ratios) {
      const result = await ContributionRecord.findOneAndUpdate(
        {
          sprintId: sprintId,
          groupId: groupId,
          studentId: ratio.studentId
        },
        {
          $set: {
            contributionRatio: ratio.ratio,
            targetStoryPoints: ratio.targetUsed,
            groupTotalStoryPoints: null,  // Will be set in batch
            lastUpdatedAt: new Date()
          }
        },
        {
          new: true,
          session: session
        }
      );

      if (result) {
        updateCount++;
      } else {
        // ISSUE #236: Handle missing record
        // Why: Student might not have contribution record yet
        // What: Create new record with ratio
        const newRecord = new ContributionRecord({
          sprintId: sprintId,
          groupId: groupId,
          studentId: ratio.studentId,
          contributionRatio: ratio.ratio,
          targetStoryPoints: ratio.targetUsed,
          storyPointsCompleted: ratio.completed,
          storyPointsAssigned: 0,
          pullRequestsMerged: 0,
          issuesResolved: 0,
          commitsCount: 0,
          gitHubHandle: 'unknown'
        });
        await newRecord.save({ session });
        updateCount++;
      }
    }

    // ISSUE #236 STEP 8b: Update SprintRecord metadata
    // Why: Track recalculation timestamp (Acceptance Criterion #4)
    // What: Update groupTotalStoryPoints and recalculatedAt
    const groupTotal = ratios.reduce((sum, r) => sum + r.completed, 0);
    await SprintRecord.findOneAndUpdate(
      {
        sprintRecordId: sprintId,
        groupId: groupId
      },
      {
        $set: {
          groupTotalStoryPoints: groupTotal,
          recalculatedAt: new Date()
        }
      },
      { session }
    );

    // ISSUE #236: Commit transaction
    // Why: All updates successful, persist to DB
    await session.commitTransaction();

    console.info('[contributionRatioService] Ratios updated successfully', {
      groupId,
      sprintId,
      updateCount,
      timestamp: new Date()
    });

    return {
      updated: updateCount,
      timestamp: new Date(),
      groupTotal: groupTotal
    };

  } catch (error) {
    // ISSUE #236: Rollback on error
    // Why: Prevent partial state (atomic guarantee)
    await session.abortTransaction();
    throw new RatioServiceError(
      500,
      'ATOMIC_WRITE_FAILED',
      `Failed to update ratios atomically: ${error.message}`
    );

  } finally {
    session.endSession();
  }
}

/**
 * ISSUE #236 PROCESS 7.4: STEP 10 - Generate Summary Response
 * Per-student breakdown + metadata (Acceptance Criterion #4)
 *
 * @param {string} groupId
 * @param {string} sprintId
 * @param {Array} ratios
 * @param {number} groupTotal
 * @param {Date} recalculatedAt
 * @returns {Object} SprintContributionSummary
 */
function generateSummary(groupId, sprintId, ratios, groupTotal, recalculatedAt) {
  // ISSUE #236 STEP 10: Generate response
  // Why: Provide detailed breakdown for audit + API response
  // What: Combine all ratios with metadata
  // Design: Matches DFD flow f7_p74_p75 output format

  return {
    groupId: groupId,
    sprintId: sprintId,
    groupTotalStoryPoints: groupTotal,
    recalculatedAt: recalculatedAt,
    strategy: ratios[0]?.strategy || 'fixed',
    contributions: ratios.map(r => ({
      studentId: r.studentId,
      contributionRatio: r.ratio,
      targetStoryPoints: r.targetUsed,
      completedStoryPoints: r.completed,
      percentageOfGroup: ((r.completed / groupTotal) * 100).toFixed(2) + '%'
    })),
    summary: {
      totalMembers: ratios.length,
      averageRatio: (ratios.reduce((sum, r) => sum + r.ratio, 0) / ratios.length).toFixed(4),
      maxRatio: Math.max(...ratios.map(r => r.ratio)).toFixed(4),
      minRatio: Math.min(...ratios.map(r => r.ratio)).toFixed(4)
    }
  };
}

/**
 * ISSUE #236 PROCESS 7.4: MAIN ORCHESTRATOR
 * Coordinates all 10 steps of the ratio calculation pipeline
 *
 * @param {string} groupId - Group to recalculate
 * @param {string} sprintId - Sprint to recalculate for
 * @param {string} userId - User initiating recalculation (for audit)
 * @param {Object} options - Optional configuration {strategy, force}
 *
 * @returns {Promise<Object>} SprintContributionSummary with all ratios
 *
 * @throws {RatioServiceError}
 *   - 404: Sprint/group not found
 *   - 403: User not authorized (not coordinator)
 *   - 409: Sprint is locked (deadline passed)
 *   - 422: No approved members OR zero group total
 *   - 500: Calculation or DB write error
 *
 * Main Steps:
 * 1. Validate inputs (auth, sprint exists)
 * 2. Check sprint not locked
 * 3. Fetch group members + Issue #235 contributions
 * 4. Load D8 targets OR use fallback
 * 5. Calculate group total
 * 6. Compute per-student ratios
 * 7. Normalize and format
 * 8. Atomic transaction update
 * 9. Update timestamps
 * 10. Return summary
 */
async function recalculateSprintRatios(groupId, sprintId, userId, options = {}) {
  // ISSUE #236: PROCESS 7.4 ORCHESTRATOR
  // Why: Central coordinator for entire ratio pipeline
  // What: Executes all 10 steps in sequence
  // Design: Delegates to specialized functions, handles errors

  try {
    console.info('[contributionRatioService.recalculateSprintRatios] Starting calculation', {
      groupId,
      sprintId,
      userId,
      timestamp: new Date()
    });

    // ISSUE #236 STEP 1: Validate
    const { sprint } = await validateInputs(groupId, sprintId, userId);

    // ISSUE #236 STEP 2: Check not locked
    checkSprintNotLocked(sprint);

    // ISSUE #236 STEP 3: Fetch contributions
    const { members, contributions: memberContributions } = await fetchGroupContributions(groupId, sprintId);

    // ISSUE #236 STEP 4-5: Load targets + group total
    const { targets, groupTotal, strategy, memberCount } = await loadTargetsAndCalculateTotal(
      groupId,
      sprintId,
      memberContributions
    );

    // ISSUE #236 STEP 6: Calculate ratios
    const ratios = await calculatePerStudentRatios(memberContributions, targets, groupTotal, strategy);

    // ISSUE #236 STEP 7-8: Atomic update
    const { timestamp } = await atomicallyUpdateRatios(groupId, sprintId, ratios);

    // ISSUE #236 STEP 10: Generate summary
    const summary = generateSummary(groupId, sprintId, ratios, groupTotal, timestamp);

    console.info('[contributionRatioService.recalculateSprintRatios] Calculation complete', {
      groupId,
      sprintId,
      members: memberCount,
      timestamp
    });

    return summary;

  } catch (error) {
    // ISSUE #236: Error handling
    // Why: Provide clear error codes for API layer
    // What: Re-throw RatioServiceError or wrap unknown errors
    if (error instanceof RatioServiceError) {
      throw error;
    }
    throw new RatioServiceError(500, 'UNKNOWN_ERROR', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS: Public API
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  recalculateSprintRatios,
  RatioServiceError,
  // Exported for testing
  validateInputs,
  checkSprintNotLocked,
  fetchGroupContributions,
  loadTargetsAndCalculateTotal,
  calculatePerStudentRatios,
  atomicallyUpdateRatios,
  generateSummary
};
