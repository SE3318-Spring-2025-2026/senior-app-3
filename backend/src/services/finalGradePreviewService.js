const Group = require('../models/Group');
const Deliverable = require('../models/Deliverable');
const SprintRecord = require('../models/SprintRecord');
const ContributionRecord = require('../models/ContributionRecord');

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
    // NOTE: This mode is intentionally side-effect aware.
    // It recalculates and persists D6 contribution ratios before preview generation.
    const { recalculateSprintRatios } = require('./contributionRatioService');
    for (const sprint of sprints) {
      try {
        await recalculateSprintRatios(groupId, sprint.sprintRecordId, requestedBy, {
          normalizationFactor: 1.0
        });
      } catch (err) {
        const statusCode = err && Number.isInteger(err.status) ? err.status : 500;
        const mappedStatusCode = statusCode === 422 ? 422 : 500;
        throw new PreviewError(
          `Latest ratio recalculation failed for sprint ${sprint.sprintRecordId}: ${err.message}`,
          mappedStatusCode
        );
      }
    }
    // Re-fetch records after math engine recalculation
    records = await ContributionRecord.find(queryD6);
  } else {
    // Strict read-only preview mode: use existing D6 contribution records as-is.
    records = await ContributionRecord.find(queryD6);
  }

  if (!records || records.length === 0) {
    throw new PreviewError('Group or required deliverable/ratio data not found in D4/D5/D6', 404);
  }

  // Calculate baseGroupScore - Mocking for now since no real scores exist
  // Calculate baseGroupScore - Mocking base score for now since no real scores exist
  // In a real scenario, this would aggregate scores from D4 and D5.
  const baseGroupScore = 100; 

  const { calculateFinalGrades } = require('./finalGradeCalculationService');
  
  try {
    const calculationResult = calculateFinalGrades(groupId, baseGroupScore, records, {
      weights: [50, 50], // example dummy weights summing to 100
      isAlreadyWeighted: false
    });
    
    return calculationResult;
  } catch (error) {
    if (error.message.includes('Inconsistent Configuration')) {
      throw new PreviewError('Conflict - preview cannot be generated due to inconsistent or locked configuration', 409);
    }
    throw error;
  }
}

module.exports = {
  generatePreview,
  PreviewError
};
