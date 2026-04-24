const crypto = require('crypto');
const mongoose = require('mongoose');

const ContributionRecord = require('../models/ContributionRecord');
const SprintRecord = require('../models/SprintRecord');
const SprintTarget = require('../models/SprintTarget');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');

class RatioServiceError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'RatioServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}

const LOCKED_SPRINT_STATUSES = new Set(['completed', 'locked', 'finalized']);
const PRECISION = 4;
const SCALE = 10 ** PRECISION;
const DEFAULT_NORMALIZATION_FACTOR = 1.0;

function roundTo(value, precision = PRECISION) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function idCandidates(id) {
  const values = [id];
  if (mongoose.Types.ObjectId.isValid(id)) {
    values.push(new mongoose.Types.ObjectId(id));
  }
  return values;
}

function buildEventId(groupId, sprintId, ratios) {
  const stablePayload = JSON.stringify(
    ratios
      .map(r => ({ studentId: String(r.studentId), ratio: r.ratio, targetUsed: r.targetUsed }))
      .sort((a, b) => a.studentId.localeCompare(b.studentId))
  );
  const digest = crypto.createHash('sha256').update(stablePayload).digest('hex').slice(0, 24);
  return `CONTRIBUTION_CALCULATED:${groupId}:${sprintId}:${digest}`;
}

async function emitContributionCalculatedHandoff(payload) {
  return {
    dispatched: true,
    event: 'CONTRIBUTION_CALCULATED',
    idempotencyKey: payload.eventId,
    payload
  };
}

async function validateInputs(groupId, sprintId, userId, session) {
  const sprint = await SprintRecord.findOne({ sprintRecordId: sprintId, groupId }).session(session);
  if (!sprint) {
    throw new RatioServiceError(404, 'NOT_FOUND', `Sprint ${sprintId} not found in group ${groupId}.`);
  }

  const membership = await GroupMembership.findOne({
    groupId,
    studentId: userId,
    status: 'approved'
  }).session(session);

  const userQuery = [{ userId }];
  if (mongoose.Types.ObjectId.isValid(userId)) {
    userQuery.push({ _id: new mongoose.Types.ObjectId(userId) });
  }
  const user = await User.findOne({ $or: userQuery }).session(session);
  const hasCoordinatorPrivilege = user && ['coordinator', 'admin'].includes(user.role);

  if (!membership || !hasCoordinatorPrivilege) {
    throw new RatioServiceError(403, 'UNAUTHORIZED', 'User is not authorized for this group as an approved coordinator member.');
  }

  return sprint;
}

function assertUnlocked(sprint, lockedCount) {
  if (sprint.locked === true || LOCKED_SPRINT_STATUSES.has(sprint.status)) {
    throw new RatioServiceError(409, 'SPRINT_LOCKED', `Sprint ${sprint.sprintRecordId} is locked.`);
  }
  if (lockedCount > 0) {
    throw new RatioServiceError(
      409,
      'CONTRIBUTION_LOCKED',
      `Sprint ${sprint.sprintRecordId} has ${lockedCount} locked contribution record(s).`
    );
  }
}

async function fetchMembersAndContributions(groupId, sprintId, session) {
  const members = await GroupMembership.find({ groupId, status: 'approved' }).session(session);
  if (!members.length) {
    throw new RatioServiceError(422, 'NO_MEMBERS', `No approved members in group ${groupId}.`);
  }

  const memberIds = members.map(member => String(member.studentId));
  const records = await ContributionRecord.find({
    groupId,
    sprintId,
    studentId: { $in: memberIds }
  }).session(session);

  const recordsByStudent = new Map(records.map(record => [String(record.studentId), record]));
  const missingContributionRecords = memberIds.filter(id => !recordsByStudent.has(id));

  const contributions = memberIds.map(studentId => {
    const existingRecord = recordsByStudent.get(studentId) || null;
    return {
      studentId,
      storyPointsCompleted: Number(existingRecord?.storyPointsCompleted || 0),
      existingRecord
    };
  });

  const lockedCount = records.filter(record => record.locked === true).length;
  const groupTotal = contributions.reduce((acc, item) => acc + item.storyPointsCompleted, 0);

  return {
    memberIds,
    contributions,
    groupTotal,
    lockedCount,
    missingContributionRecords
  };
}

function ensureProcess73Ready(missingContributionRecords) {
  if (missingContributionRecords.length > 0) {
    throw new RatioServiceError(
      409,
      'PROCESS_7_3_REQUIRED',
      `Cannot calculate ratios: Sprint attribution (Process 7.3) is incomplete for the following students: ${missingContributionRecords.join(', ')}. Please run GitHub/JIRA sync first.`,
      { missingStudentIds: missingContributionRecords }
    );
  }
}

async function loadTargetsFromD8(groupId, sprintId, memberIds, session) {
  const targets = await SprintTarget.find({
    sprintId: { $in: idCandidates(sprintId) },
    groupId: { $in: idCandidates(groupId) },
    studentId: { $in: memberIds.flatMap(idCandidates) },
    deletedAt: null
  }).session(session);

  if (targets.length === 0) {
    throw new RatioServiceError(422, 'MISSING_D8_TARGETS', 'Sprint target data (D8) is missing.');
  }

  const targetMap = new Map();
  for (const targetDoc of targets) {
    const studentId = String(targetDoc.studentId);
    const target = Number(targetDoc.targetStoryPoints);
    if (!Number.isFinite(target) || target <= 0) {
      throw new RatioServiceError(422, 'INVALID_TARGET_STORY_POINTS', 'Target story points must be greater than zero.');
    }
    targetMap.set(studentId, target);
  }

  const missingStudentIds = memberIds.filter(id => !targetMap.has(String(id)));
  if (missingStudentIds.length > 0) {
    throw new RatioServiceError(
      422,
      'MISSING_D8_TARGETS',
      'Sprint target data (D8) is missing for some group members.',
      { missingStudentIds }
    );
  }

  return targetMap;
}

function normalizeGroupRatios(contributions, targetMap, normalizationFactor = DEFAULT_NORMALIZATION_FACTOR) {
  if (!Number.isFinite(normalizationFactor) || normalizationFactor <= 0) {
    throw new RatioServiceError(422, 'INVALID_NORMALIZATION_FACTOR', 'Normalization factor must be greater than zero.');
  }

  const maxPossible = contributions.length;
  if (normalizationFactor > maxPossible) {
    throw new RatioServiceError(
      422,
      'INVALID_NORMALIZATION_FACTOR',
      `Normalization factor ${normalizationFactor} exceeds max possible ${maxPossible}.`
    );
  }

  const rawRatios = contributions.map(item => {
    const target = Number(targetMap.get(String(item.studentId)));
    const raw = item.storyPointsCompleted / target;
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });

  const rawTotal = rawRatios.reduce((sum, value) => sum + value, 0);
  if (rawTotal <= 0) {
    throw new RatioServiceError(422, 'ZERO_GROUP_TOTAL', 'Group total story points must be greater than zero.');
  }

  const normalized = rawRatios.map(value => clamp01((value / rawTotal) * normalizationFactor));
  const scaled = normalized.map(value => value * SCALE);

  const floors = scaled.map(value => Math.floor(value));
  const remainders = scaled.map((value, index) => ({ index, remainder: value - floors[index] }));
  let allocated = floors.reduce((sum, value) => sum + value, 0);
  const targetUnits = Math.round(normalizationFactor * SCALE);
  let unitsToDistribute = targetUnits - allocated;

  if (unitsToDistribute > 0) {
    remainders.sort((a, b) => b.remainder - a.remainder);
    for (const item of remainders) {
      if (unitsToDistribute === 0) break;
      if (floors[item.index] < SCALE) {
        floors[item.index] += 1;
        unitsToDistribute -= 1;
      }
    }
  } else if (unitsToDistribute < 0) {
    remainders.sort((a, b) => a.remainder - b.remainder);
    unitsToDistribute = Math.abs(unitsToDistribute);
    for (const item of remainders) {
      if (unitsToDistribute === 0) break;
      if (floors[item.index] > 0) {
        floors[item.index] -= 1;
        unitsToDistribute -= 1;
      }
    }
  }

  const finalizedRatios = floors.map(value => roundTo(value / SCALE));
  const finalSum = roundTo(finalizedRatios.reduce((sum, value) => sum + value, 0));
  const expected = roundTo(normalizationFactor);
  // Mathematical fail-safe: prevents silent precision regressions in normalization.
  if (finalSum !== expected) {
    throw new RatioServiceError(
      500,
      'NORMALIZATION_DRIFT',
      `Normalization drift detected. Expected ${expected}, got ${finalSum}.`
    );
  }

  return contributions.map((item, index) => ({
    studentId: item.studentId,
    ratio: finalizedRatios[index],
    targetUsed: Number(targetMap.get(String(item.studentId))),
    completed: item.storyPointsCompleted,
    existingRecord: item.existingRecord
  }));
}

async function persistRatios(groupId, sprintId, ratios, groupTotal, eventId, session) {
  const now = new Date();
  let updatedCount = 0;

  for (const ratio of ratios) {
    const result = await ContributionRecord.updateOne(
      { groupId, sprintId, studentId: ratio.studentId },
      {
        $set: {
          contributionRatio: ratio.ratio,
          targetStoryPoints: ratio.targetUsed,
          groupTotalStoryPoints: groupTotal,
          recalculatedAt: now,
          lastHandoffEventId: eventId,
          lastUpdatedAt: now
        }
      },
      { session, runValidators: true }
    );

    if (result.matchedCount > 0) {
      updatedCount += 1;
    } else {
      const record = new ContributionRecord({
        sprintId,
        groupId,
        studentId: ratio.studentId,
        storyPointsCompleted: ratio.completed,
        storyPointsAssigned: 0,
        pullRequestsMerged: 0,
        issuesResolved: 0,
        commitsCount: 0,
        contributionRatio: ratio.ratio,
        targetStoryPoints: ratio.targetUsed,
        groupTotalStoryPoints: groupTotal,
        recalculatedAt: now,
        locked: false,
        lastHandoffEventId: eventId,
        gitHubHandle: 'unknown',
        lastUpdatedAt: now
      });
      await record.save({ session, validateBeforeSave: true });
      updatedCount += 1;
    }
  }

  await SprintRecord.updateOne(
    { sprintRecordId: sprintId, groupId },
    {
      $set: {
        groupTotalStoryPoints: groupTotal,
        recalculatedAt: now
      }
    },
    { session }
  );

  return { updatedCount, now };
}

function generateSummary(groupId, sprintId, ratios, groupTotalStoryPoints, recalculatedAt, lockedCount) {
  const ratioSum = roundTo(ratios.reduce((sum, item) => sum + item.ratio, 0));
  return {
    groupId,
    sprintId,
    groupTotalStoryPoints,
    lockedCount,
    recalculatedAt,
    strategy: 'normalized',
    contributions: ratios.map(item => ({
      studentId: item.studentId,
      contributionRatio: item.ratio,
      targetStoryPoints: item.targetUsed,
      completedStoryPoints: item.completed,
      percentageOfGroup:
        groupTotalStoryPoints > 0
          ? `${roundTo((item.completed / groupTotalStoryPoints) * 100, 2).toFixed(2)}%`
          : '0.00%'
    })),
    summary: {
      totalMembers: ratios.length,
      averageRatio: roundTo(ratioSum / ratios.length).toFixed(4),
      maxRatio: roundTo(Math.max(...ratios.map(item => item.ratio))).toFixed(4),
      minRatio: roundTo(Math.min(...ratios.map(item => item.ratio))).toFixed(4),
      normalizationFactor: ratioSum.toFixed(4)
    }
  };
}

async function recalculateSprintRatios(groupId, sprintId, userId, options = {}) {
  const session = await mongoose.startSession();
  try {
    let summary;
    await session.withTransaction(async () => {
      const sprint = await validateInputs(groupId, sprintId, userId, session);
      const {
        memberIds,
        contributions,
        groupTotal,
        lockedCount,
        missingContributionRecords
      } = await fetchMembersAndContributions(groupId, sprintId, session);

      ensureProcess73Ready(missingContributionRecords);
      assertUnlocked(sprint, lockedCount);

      if (groupTotal <= 0) {
        throw new RatioServiceError(422, 'ZERO_GROUP_TOTAL', 'Group total story points must be greater than zero.');
      }

      const targetMap = await loadTargetsFromD8(groupId, sprintId, memberIds, session);
      const normalizationFactor = Number(options.normalizationFactor) || DEFAULT_NORMALIZATION_FACTOR;
      const ratios = normalizeGroupRatios(contributions, targetMap, normalizationFactor);
      const eventId = buildEventId(groupId, sprintId, ratios);

      const alreadyApplied = ratios.every(ratio => {
        const existing = ratio.existingRecord;
        return (
          existing &&
          existing.lastHandoffEventId === eventId &&
          roundTo(existing.contributionRatio) === ratio.ratio
        );
      });

      let recalculatedAt = new Date();
      if (!alreadyApplied) {
        const persisted = await persistRatios(groupId, sprintId, ratios, groupTotal, eventId, session);
        recalculatedAt = persisted.now;
        await emitContributionCalculatedHandoff({
          eventId,
          groupId,
          sprintId,
          recalculatedAt,
          groupTotalStoryPoints: groupTotal,
          contributions: ratios.map(item => ({
            studentId: item.studentId,
            contributionRatio: item.ratio
          }))
        });
      }

      summary = generateSummary(groupId, sprintId, ratios, groupTotal, recalculatedAt, lockedCount);
    });
    return summary;
  } catch (error) {
    if (error instanceof RatioServiceError) {
      throw error;
    }
    throw new RatioServiceError(500, 'CALCULATION_ERROR', error.message);
  } finally {
    session.endSession();
  }
}

module.exports = {
  RatioServiceError,
  recalculateSprintRatios,
  validateInputs,
  loadTargetsFromD8,
  normalizeGroupRatios,
  emitContributionCalculatedHandoff,
  generateSummary
};
