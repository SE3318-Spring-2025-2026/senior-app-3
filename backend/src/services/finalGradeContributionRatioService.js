const mongoose = require('mongoose');

const ContributionRecord = require('../models/ContributionRecord');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');

class FinalGradeRatioResolverError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'FinalGradeRatioResolverError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new FinalGradeRatioResolverError(
      400,
      'INVALID_PREVIEW_FILTER',
      `${fieldName} must be an array of strings.`,
      { field: fieldName }
    );
  }

  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return [...new Set(normalized)];
}

function getGroupQuery(groupId) {
  const candidates = [{ groupId }];
  if (mongoose.Types.ObjectId.isValid(groupId)) {
    candidates.push({ _id: new mongoose.Types.ObjectId(groupId) });
  }
  return { $or: candidates };
}

function getRecordTimestamp(record) {
  return (
    record.recalculatedAt ||
    record.lastUpdatedAt ||
    record.updatedAt ||
    record.createdAt ||
    new Date(0)
  );
}

function compareRecordsByRecency(a, b) {
  return getRecordTimestamp(b).getTime() - getRecordTimestamp(a).getTime();
}

function roundTo(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function assertUsableRatio(record) {
  const ratio = Number(record.contributionRatio);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new FinalGradeRatioResolverError(
      409,
      'INVALID_CONTRIBUTION_RATIO',
      `D6 contribution ratio is invalid for student ${record.studentId}.`,
      {
        studentId: String(record.studentId),
        sprintId: String(record.sprintId),
        contributionRecordId: record.contributionRecordId || String(record._id),
        contributionRatio: record.contributionRatio,
      }
    );
  }
}

async function loadGroup(groupId) {
  if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
    throw new FinalGradeRatioResolverError(
      400,
      'INVALID_GROUP_ID',
      'groupId must be a non-empty string.'
    );
  }

  const group = await Group.findOne(getGroupQuery(groupId.trim())).lean();
  if (!group) {
    throw new FinalGradeRatioResolverError(
      404,
      'GROUP_NOT_FOUND',
      `Group ${groupId} was not found.`
    );
  }

  return group;
}

async function loadEnrolledStudentIds(group) {
  const memberships = await GroupMembership.find({
    groupId: group.groupId,
    status: 'approved',
  })
    .select('studentId')
    .lean();

  if (memberships.length > 0) {
    return [...new Set(memberships.map((membership) => String(membership.studentId)))];
  }

  const embeddedAcceptedMembers = (group.members || [])
    .filter((member) => member && member.status === 'accepted' && member.userId)
    .map((member) => String(member.userId));

  return [...new Set(embeddedAcceptedMembers)];
}

function buildUserLookupQuery(studentIds) {
  const validObjectIds = studentIds
    .filter((studentId) => mongoose.Types.ObjectId.isValid(studentId))
    .map((studentId) => new mongoose.Types.ObjectId(studentId));

  const query = [
    { userId: { $in: studentIds } },
    { studentId: { $in: studentIds } },
  ];

  if (validObjectIds.length > 0) {
    query.push({ _id: { $in: validObjectIds } });
  }

  return { $or: query };
}

function mapUsersByKnownIds(users) {
  const usersById = new Map();
  for (const user of users) {
    const ids = [user.userId, user.studentId, user._id ? String(user._id) : null].filter(Boolean);
    for (const id of ids) {
      usersById.set(String(id), user);
    }
  }
  return usersById;
}

async function buildGithubMappingWarnings(groupId, studentIds) {
  if (studentIds.length === 0) {
    return [];
  }

  const users = await User.find(buildUserLookupQuery(studentIds))
    .select('userId studentId githubUsername')
    .lean();
  const usersById = mapUsersByKnownIds(users);

  return studentIds
    .filter((studentId) => {
      const user = usersById.get(String(studentId));
      return !user || !user.githubUsername;
    })
    .map((studentId) => ({
      code: 'MISSING_GITHUB_MAPPING',
      severity: 'warning',
      groupId,
      studentId,
      message: `Student ${studentId} does not have a GitHub username mapping.`,
    }));
}

function buildRatioQuery(groupId, studentIds, includeSprintIds) {
  const query = {
    groupId,
    studentId: { $in: studentIds },
  };

  if (includeSprintIds.length > 0) {
    query.sprintId = { $in: includeSprintIds };
  }

  return query;
}

function selectLatestRecords(studentIds, recordsByStudent) {
  const selected = [];

  for (const studentId of studentIds) {
    const records = recordsByStudent.get(studentId) || [];
    if (records.length > 0) {
      records.sort(compareRecordsByRecency);
      selected.push({
        studentId,
        records: [records[0]],
        contributionRatio: Number(records[0].contributionRatio),
      });
    }
  }

  return selected;
}

function selectExplicitSprintRecords(studentIds, recordsByStudent) {
  const selected = [];

  for (const studentId of studentIds) {
    const records = recordsByStudent.get(studentId) || [];
    if (records.length > 0) {
      const ratioTotal = records.reduce(
        (sum, record) => sum + Number(record.contributionRatio),
        0
      );
      selected.push({
        studentId,
        records,
        contributionRatio: roundTo(ratioTotal / records.length),
      });
    }
  }

  return selected;
}

function formatSelectedStudent(entry) {
  const recordsByRecency = [...entry.records].sort(compareRecordsByRecency);

  return {
    studentId: entry.studentId,
    contributionRatio: entry.contributionRatio,
    selectedSprintIds: recordsByRecency.map((record) => String(record.sprintId)),
    contributionRecordIds: recordsByRecency.map((record) =>
      record.contributionRecordId || String(record._id)
    ),
    sourceTimestamps: recordsByRecency.map((record) => ({
      sprintId: String(record.sprintId),
      recalculatedAt: record.recalculatedAt || null,
      lastUpdatedAt: record.lastUpdatedAt || null,
      updatedAt: record.updatedAt || null,
    })),
  };
}

async function resolveContributionRatiosForPreview(groupId, input = {}) {
  const group = await loadGroup(groupId);
  const includeSprintIds = normalizeStringArray(input.includeSprintIds, 'includeSprintIds');
  const useLatestRatios = input.useLatestRatios !== false;
  const mode = useLatestRatios ? 'latest' : 'explicit_sprints';

  if (!useLatestRatios && includeSprintIds.length === 0) {
    throw new FinalGradeRatioResolverError(
      400,
      'MISSING_INCLUDE_SPRINT_IDS',
      'includeSprintIds is required when useLatestRatios is false.'
    );
  }

  const enrolledStudentIds = await loadEnrolledStudentIds(group);
  if (enrolledStudentIds.length === 0) {
    throw new FinalGradeRatioResolverError(
      404,
      'NO_ENROLLED_STUDENTS',
      `Group ${group.groupId} does not have enrolled students for final grade preview.`
    );
  }

  const records = await ContributionRecord.find(
    buildRatioQuery(group.groupId, enrolledStudentIds, includeSprintIds)
  )
    .sort({ recalculatedAt: -1, lastUpdatedAt: -1, updatedAt: -1 })
    .lean();

  records.forEach(assertUsableRatio);

  const recordsByStudent = new Map();
  for (const record of records) {
    const studentId = String(record.studentId);
    if (!recordsByStudent.has(studentId)) {
      recordsByStudent.set(studentId, []);
    }
    recordsByStudent.get(studentId).push(record);
  }

  const selected = useLatestRatios
    ? selectLatestRecords(enrolledStudentIds, recordsByStudent)
    : selectExplicitSprintRecords(enrolledStudentIds, recordsByStudent);

  const selectedStudentIds = new Set(selected.map((entry) => entry.studentId));
  const missingStudentIds = enrolledStudentIds.filter(
    (studentId) => !selectedStudentIds.has(studentId)
  );

  if (missingStudentIds.length > 0) {
    throw new FinalGradeRatioResolverError(
      404,
      'MISSING_CONTRIBUTION_RATIOS',
      'Required contribution ratios are missing for one or more enrolled students.',
      {
        groupId: group.groupId,
        missingStudentIds,
        includeSprintIds,
        useLatestRatios,
      }
    );
  }

  const warnings = await buildGithubMappingWarnings(group.groupId, enrolledStudentIds);

  return {
    groupId: group.groupId,
    students: selected.map(formatSelectedStudent),
    warnings,
    metadata: {
      mode,
      useLatestRatios,
      includeSprintIds,
      enrolledStudentCount: enrolledStudentIds.length,
      generatedAt: new Date(),
    },
  };
}

module.exports = {
  FinalGradeRatioResolverError,
  resolveContributionRatiosForPreview,
};
