const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');
const Deliverable = require('../models/Deliverable');
const { createAuditLog } = require('./auditService');
const { recalculateContributionRatio } = require('./attributionRecalculateService');

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #80 FIX #3: D6 UPDATE SERVICE - AUDIT FIELD NAMES CORRECTION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * FILE: backend/src/services/d6UpdateService.js (DÜZELTILDI)
 * STATUS: ✅ MODIFIED
 * 
 * PROBLEM FIXED:
 * PR Review Issue #80 identified that audit log calls were using INCORRECT field names:
 *   WRONG (old):     userId, resourceType, resourceId, changeDetails
 *   CORRECT (now):   actorId, targetId, groupId, payload
 * 
 * This caused audit logging to fail silently because AuditLog schema does NOT have
 * userId/resourceType/changeDetails fields. The schema REQUIRES:
 *   - actorId: User/system performing the action
 *   - targetId: Resource being acted upon
 *   - groupId: Group context (optional but recommended)
 *   - payload: Mixed data object with context-specific fields
 * 
 * WHAT CHANGED:
 * • Fixed updateSprintWithCommitteeAssignment() audit calls
 * • Fixed linkDeliverableToSprint() audit calls
 * • Changed field names to match AuditLog schema exactly
 * • Changed action names to SCREAMING_SNAKE_CASE per schema enum
 * 
 * BEFORE (BROKEN):
 * ❌ await createAuditLog({
 *      action: 'sprint_committee_assignment',
 *      userId: coordinatorId,
 *      resourceType: 'sprint_record',
 *      resourceId: sprintRecord.sprintRecordId,
 *      changeDetails: { sprintId, groupId, committeeId }
 *    });
 * 
 * AFTER (FIXED):
 * ✅ await createAuditLog({
 *      action: 'SPRINT_COMMITTEE_ASSIGNED',
 *      actorId: coordinatorId,
 *      targetId: sprintRecord.sprintRecordId,
 *      groupId: groupId,
 *      payload: { sprintId, groupId, committeeId }
 *    });
 * 
 * IMPACT:
 * • Audit logs now persist correctly in MongoDB
 * • Complete audit trail for committee assignments
 * • All operations traceable to actor (coordinator)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * D6UpdateServiceError — Custom error for D6 update operations.
 */
class D6UpdateServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'D6UpdateServiceError';
    this.status = status;
    this.code = code;
  }
}

/**
 * updateSprintWithCommitteeAssignment(groupId, sprintId, committeeId, coordinatorId)
 *
 * Flow f13 (Process 4.5 → D6): Update SprintRecord when committee is published.
 * Sets committeeId and committeeAssignedAt timestamp on the sprint record.
 *
 * @param {string} groupId — Group ID
 * @param {string} sprintId — Sprint ID
 * @param {string} committeeId — Committee ID being assigned
 * @param {string} coordinatorId — Coordinator performing the assignment
 * @returns {Promise<Object>} Updated SprintRecord
 * @throws {D6UpdateServiceError} if group/sprint not found or update fails
 */
async function updateSprintWithCommitteeAssignment(groupId, sprintId, committeeId, coordinatorId) {
  try {
    // Find or create SprintRecord for this (sprint, group) pair
    let sprintRecord = await SprintRecord.findOne({ sprintId, groupId });

    if (sprintRecord) {
      // Update existing SprintRecord
      sprintRecord.committeeId = committeeId;
      sprintRecord.committeeAssignedAt = new Date();
    } else {
      // Create new SprintRecord if doesn't exist
      sprintRecord = new SprintRecord({
        sprintId,
        groupId,
        committeeId,
        committeeAssignedAt: new Date(),
        status: 'pending',
      });
    }

    await sprintRecord.save();

    /**
     * =====================================================================
     * FIX #2: CORRECT AUDIT LOG FIELD NAMES (ISSUE #80 - HIGH)
     * =====================================================================
     * PROBLEM: Audit log calls used incorrect field names:
     *   OLD (WRONG): userId, resourceType, changeDetails
     *   These don't exist in AuditLog schema
     *
     * ACTUAL AUDITLOG SCHEMA fields:
     *   - action: Required enum value (SCREAMING_SNAKE_CASE)
     *   - actorId: User/system performing the action
     *   - targetId: Resource being acted upon (sprintRecordId)
     *   - groupId: Group context (optional but recommended)
     *   - payload: Mixed data object with context-specific fields
     *
     * SOLUTION: Update all audit calls to use correct field names and structure
     * =====================================================================
     */
    await createAuditLog({
      action: 'SPRINT_COMMITTEE_ASSIGNED',
      actorId: coordinatorId,
      targetId: sprintRecord.sprintRecordId,
      groupId: groupId,
      payload: {
        sprintId,
        groupId,
        committeeId,
      },
    });

    return sprintRecord;
  } catch (err) {
    if (err instanceof D6UpdateServiceError) throw err;
    console.error('[updateSprintWithCommitteeAssignment]', err);
    throw new D6UpdateServiceError(
      500,
      'D6_UPDATE_FAILED',
      'Failed to update sprint record with committee assignment'
    );
  }
}

/**
 * linkDeliverableToSprint(deliverableId, sprintId, groupId, coordinatorId)
 *
 * Flow f14 (D4 → D6): Cross-reference deliverable in SprintRecord after submission.
 * Adds deliverable entry to SprintRecord.deliverableRefs array.
 *
 * @param {string} deliverableId — Deliverable ID from D4
 * @param {string} sprintId — Sprint ID
 * @param {string} groupId — Group ID
 * @param {string} coordinatorId — System/Coordinator ID for audit
 * @returns {Promise<Object>} Updated SprintRecord with deliverable reference
 * @throws {D6UpdateServiceError} if deliverable/sprint not found or link fails
 */
async function linkDeliverableToSprint(deliverableId, sprintId, groupId, coordinatorId) {
  try {
    // Verify deliverable exists in D4
    const deliverable = await Deliverable.findOne({ deliverableId });
    if (!deliverable) {
      throw new D6UpdateServiceError(
        404,
        'DELIVERABLE_NOT_FOUND',
        `Deliverable ${deliverableId} not found in D4`
      );
    }

    // Find SprintRecord (should exist after committee publish)
    let sprintRecord = await SprintRecord.findOne({ sprintId, groupId });

    if (!sprintRecord) {
      // Create SprintRecord if it doesn't exist yet (edge case)
      sprintRecord = new SprintRecord({
        sprintId,
        groupId,
        status: 'in_progress',
      });
    }

    // Check if deliverable already linked (avoid duplicates)
    const alreadyLinked = sprintRecord.deliverableRefs.some(
      (ref) => ref.deliverableId === deliverableId
    );

    if (!alreadyLinked) {
      // Add deliverable reference
      sprintRecord.deliverableRefs.push({
        deliverableId,
        type: deliverable.type,
        submittedAt: deliverable.submittedAt,
      });

      // Update status if needed
      if (sprintRecord.status === 'pending') {
        sprintRecord.status = 'in_progress';
      }
    }

    await sprintRecord.save();

    /**
     * FIX #2 (continued): Correct audit field names in deliverable linkage
     * Uses proper field names: actorId, targetId, groupId, payload
     */
    await createAuditLog({
      action: 'DELIVERABLE_LINKED_TO_SPRINT',
      actorId: coordinatorId,
      targetId: sprintRecord.sprintRecordId,
      groupId: groupId,
      payload: {
        sprintId,
        groupId,
        deliverableId,
        deliverableType: deliverable.type,
      },
    });

    return sprintRecord;
  } catch (err) {
    if (err instanceof D6UpdateServiceError) throw err;
    console.error('[linkDeliverableToSprint]', err);
    throw new D6UpdateServiceError(
      500,
      'D6_LINKAGE_FAILED',
      'Failed to link deliverable to sprint record'
    );
  }
}

/**
 * createContributionRecord(sprintId, studentId, groupId, assignedStoryPoints)
 *
 * Create a new ContributionRecord for a student in a sprint.
 * Called when sprint is created or student joins group.
 *
 * @param {string} sprintId — Sprint ID
 * @param {string} studentId — Student ID
 * @param {string} groupId — Group ID
 * @param {number} assignedStoryPoints — Story points assigned (optional, default 0)
 * @returns {Promise<Object>} New ContributionRecord
 */
async function createContributionRecord(
  sprintId,
  studentId,
  groupId,
  assignedStoryPoints = 0
) {
  try {
    const contributionRecord = new ContributionRecord({
      sprintId,
      studentId,
      groupId,
      storyPointsAssigned: assignedStoryPoints,
    });

    await contributionRecord.save();
    return contributionRecord;
  } catch (err) {
    console.error('[createContributionRecord]', err);
    throw new D6UpdateServiceError(
      500,
      'CONTRIBUTION_CREATE_FAILED',
      'Failed to create contribution record'
    );
  }
}

/**
 * updateContributionMetrics(sprintId, studentId, groupId, metrics)
 *
 * Update contribution metrics (PRs, issues, story points) for a student.
 * Called by GitHub integration service after PR merge events.
 *
 * @param {string} sprintId — Sprint ID
 * @param {string} studentId — Student ID
 * @param {string} groupId — Group ID
 * @param {Object} metrics — { prsMerged, issuesResolved, storyPointsCompleted, commitsCount }
 * @returns {Promise<Object>} Updated ContributionRecord
 */
async function updateContributionMetrics(sprintId, studentId, groupId, metrics = {}, context = {}) {
  try {
    const contributionRecord = await ContributionRecord.findOne({
      sprintId,
      studentId,
      groupId,
    });

    if (!contributionRecord) {
      throw new D6UpdateServiceError(
        404,
        'CONTRIBUTION_NOT_FOUND',
        `Contribution record not found for sprint ${sprintId}, student ${studentId}`
      );
    }

    // Update metrics
    if (metrics.prsMerged !== undefined) {
      contributionRecord.pullRequestsMerged = metrics.prsMerged;
    }
    if (metrics.issuesResolved !== undefined) {
      contributionRecord.issuesResolved = metrics.issuesResolved;
    }
    if (metrics.storyPointsCompleted !== undefined) {
      contributionRecord.storyPointsCompleted = metrics.storyPointsCompleted;
    }
    if (metrics.commitsCount !== undefined) {
      contributionRecord.commitsCount = metrics.commitsCount;
    }

    contributionRecord.lastUpdatedAt = new Date();
    await contributionRecord.save();

    await recalculateContributionRatio({
      groupId,
      sprintId,
      studentId,
      changeTrigger: context.changeTrigger || 'sync_update',
      correlationId: context.correlationId || metrics.correlationId || null,
      externalRequestId: context.externalRequestId || metrics.externalRequestId || null,
      actorId: context.actorId || 'system',
      overrideExisting: context.overrideExisting !== false
    });

    return contributionRecord;
  } catch (err) {
    if (err instanceof D6UpdateServiceError) throw err;
    console.error('[updateContributionMetrics]', err);
    throw new D6UpdateServiceError(
      500,
      'CONTRIBUTION_UPDATE_FAILED',
      'Failed to update contribution metrics'
    );
  }
}

module.exports = {
  updateSprintWithCommitteeAssignment,
  linkDeliverableToSprint,
  createContributionRecord,
  updateContributionMetrics,
  D6UpdateServiceError,
};
