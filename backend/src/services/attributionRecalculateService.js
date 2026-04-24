const ContributionRecord = require('../models/ContributionRecord');
const { createAuditLog } = require('./auditService');

function calculateRatio(storyPointsCompleted, storyPointsAssigned) {
  if (!storyPointsAssigned || storyPointsAssigned <= 0) {
    return 0;
  }
  return storyPointsCompleted / storyPointsAssigned;
}

async function recalculateContributionRatio({
  groupId,
  sprintId,
  studentId,
  changeTrigger = 'sync_update',
  correlationId = null,
  externalRequestId = null,
  actorId = 'system',
  overrideExisting = true
}) {
  const record = await ContributionRecord.findOne({ groupId, sprintId, studentId });
  if (!record) {
    return null;
  }

  const oldRatio = record.contributionRatio || 0;
  const newRatio = calculateRatio(record.storyPointsCompleted, record.storyPointsAssigned);

  if (overrideExisting) {
    record.contributionRatio = newRatio;
    record.lastUpdatedAt = new Date();
    await record.save();
  }

  await createAuditLog({
    action: 'ATTRIBUTION_RATIO_CHANGED',
    actorId,
    targetId: record.contributionRecordId,
    groupId,
    payload: {
      groupId,
      sprintId,
      studentId,
      oldRatio,
      newRatio,
      changeTrigger,
      correlationId,
      externalRequestId,
      overrideExisting
    }
  });

  return { oldRatio, newRatio, contributionRecordId: record.contributionRecordId };
}

module.exports = {
  recalculateContributionRatio
};
