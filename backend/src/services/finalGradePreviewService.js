const Group = require('../models/Group');
const Deliverable = require('../models/Deliverable');
const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');
const { FinalGrade } = require('../models/FinalGrade');

class PreviewError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'PreviewError';
    this.statusCode = statusCode;
  }
}

async function generatePreview(groupId, options) {
  const { requestedBy, includeDeliverableIds, includeSprintIds, useLatestRatios = true } = options;

  // 1. Check if group exists
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new PreviewError(`Group ${groupId} not found`, 404);
  }

  // 1.5 Ownership Check
  if (options.requestedByRole !== 'coordinator' && options.requestedByRole !== 'admin') {
    if (group.advisorId !== requestedBy && group.professorId !== requestedBy) {
      throw new PreviewError('Forbidden - only the Coordinator role or authorized Professor/Advisor roles may preview final grades', 403);
    }
  }

  // 409 Conflict check
  if (group.status === 'archived' || group.status === 'rejected') {
    throw new PreviewError('Conflict - preview cannot be generated due to inconsistent or locked configuration', 409);
  }

  // 2. Fetch Deliverables (D4)
  const queryD4 = { groupId };
  if (includeDeliverableIds && includeDeliverableIds.length > 0) {
    queryD4.deliverableId = { $in: includeDeliverableIds };
  }
  const deliverables = await Deliverable.find(queryD4);
  if (!deliverables || deliverables.length === 0) {
    throw new PreviewError('Group or required deliverable/ratio data not found in D4/D5/D6', 404);
  }

  // 3. Fetch Sprints (D6)
  const queryD6 = { groupId };
  if (includeSprintIds && includeSprintIds.length > 0) {
    queryD6.sprintId = { $in: includeSprintIds };
  }
  const sprints = await SprintRecord.find(queryD6);
  if (!sprints || sprints.length === 0) {
    throw new PreviewError('Group or required deliverable/ratio data not found in D4/D5/D6', 404);
  }

  // 5. Math Engine Orchestration
  let records;
  if (useLatestRatios) {
    const { recalculateSprintRatios } = require('./contributionRatioService');
    for (const sprint of sprints) {
      try {
        await recalculateSprintRatios(groupId, sprint.sprintId, requestedBy, {
          normalizationFactor: 1.0
        });
      } catch (err) {
        console.warn(`[Preview] Failed to recalculate ratios for sprint ${sprint.sprintId}:`, err.message);
      }
    }
    // Re-fetch records after math engine recalculation
    records = await ContributionRecord.find(queryD6);
  } else {
    records = await ContributionRecord.find(queryD6);
  }

  if (!records || records.length === 0) {
    throw new PreviewError('Group or required deliverable/ratio data not found in D4/D5/D6', 404);
  }

  // Calculate baseGroupScore - Mocking for now since no real scores exist
  // In a real scenario, this would aggregate scores from D4 and D5.
  const baseGroupScore = 100; 

  const studentGrades = new Map();
  let totalRatio = 0;

  for (const record of records) {
    const { studentId, contributionRatio } = record;
    totalRatio += (contributionRatio || 0);

    if (!studentGrades.has(studentId)) {
      studentGrades.set(studentId, {
        studentId,
        contributionRatio: contributionRatio || 0,
        computedFinalGrade: baseGroupScore * (contributionRatio || 0),
        deliverableScoreBreakdown: {}
      });
    }
  }

  // Ratio consistency check (sum should be ~1.0 within epsilon for precision, or 0 if group has 0 total story points)
  // We use 1.0 as target because ratio math is normalized. A margin of 0.01 is used for floating point issues.
  if (totalRatio > 0 && Math.abs(totalRatio - 1.0) > 0.01) {
    throw new PreviewError('Conflict - preview cannot be generated due to inconsistent or locked configuration', 409);
  }

  return {
    groupId,
    baseGroupScore,
    students: Array.from(studentGrades.values()),
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  generatePreview,
  PreviewError
};
