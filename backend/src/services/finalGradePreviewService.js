const { resolveContributionRatiosForPreview } = require('./finalGradeContributionRatioService');

function roundTo(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeWarningsByStudent(warnings = []) {
  const warningsByStudent = new Map();
  for (const warning of warnings) {
    if (!warning || !warning.studentId) {
      continue;
    }

    const studentId = String(warning.studentId);
    if (!warningsByStudent.has(studentId)) {
      warningsByStudent.set(studentId, []);
    }

    warningsByStudent.get(studentId).push({
      code: warning.code,
      severity: warning.severity,
      message: warning.message,
    });
  }
  return warningsByStudent;
}

async function buildFinalGradesPreview(groupId, input = {}) {
  const {
    includeSprintIds,
    useLatestRatios,
    includeDeliverableIds = [],
    baseGroupScore: explicitBaseGroupScore,
  } = input;

  // Process 8.1 placeholder: until D4/D5 aggregation service is wired,
  // default to a neutral base group score that keeps preview deterministic.
  const baseGroupScore = Number.isFinite(Number(explicitBaseGroupScore))
    ? Number(explicitBaseGroupScore)
    : 100;

  const ratioResolution = await resolveContributionRatiosForPreview(groupId, {
    includeSprintIds,
    useLatestRatios,
  });
  const warningsByStudent = normalizeWarningsByStudent(ratioResolution.warnings);

  const students = ratioResolution.students.map((student) => ({
    studentId: student.studentId,
    contributionRatio: student.contributionRatio,
    computedFinalGrade: roundTo(baseGroupScore * student.contributionRatio),
    deliverableScoreBreakdown: {},
    warnings: warningsByStudent.get(student.studentId) || [],
  }));

  return {
    groupId: ratioResolution.groupId,
    baseGroupScore,
    students,
    createdAt: new Date(),
    // Keep rich resolver payload for internal observability and logging.
    internal: {
      includeDeliverableIds,
      ratioResolution,
    },
  };
}

module.exports = {
  buildFinalGradesPreview,
};
