const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');
const Deliverable = require('../models/Deliverable');
const { createAuditLog } = require('./auditService');

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

    // Create audit log
    await createAuditLog({
      action: 'sprint_committee_assignment',
      userId: coordinatorId,
      resourceType: 'sprint_record',
      resourceId: sprintRecord.sprintRecordId,
      changeDetails: {
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

    // Create audit log
    await createAuditLog({
      action: 'deliverable_linked_to_sprint',
      userId: coordinatorId,
      resourceType: 'sprint_record',
      resourceId: sprintRecord.sprintRecordId,
      changeDetails: {
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
async function updateContributionMetrics(sprintId, studentId, groupId, metrics = {}) {
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

    // Calculate contribution ratio if we have story points assigned
    if (contributionRecord.storyPointsAssigned > 0) {
      contributionRecord.contributionRatio =
        contributionRecord.storyPointsCompleted /
        contributionRecord.storyPointsAssigned;
    }

    contributionRecord.lastUpdatedAt = new Date();
    await contributionRecord.save();

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
