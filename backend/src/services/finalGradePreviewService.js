const { resolveContributionRatiosForPreview } = require('./finalGradeContributionRatioService');
const { FinalGradeCalculationService } = require('./finalGradeCalculationService');

class PreviewError extends Error {
  constructor(message, statusCode = 500, code = 'PREVIEW_ERROR') {
    super(message);
    this.name = 'PreviewError';
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
  }
}

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

async function generatePreview(groupId, input = {}) {
  try {
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      throw new PreviewError('groupId is required', 400, 'INVALID_GROUP_ID');
    }

    const preview = await buildFinalGradesPreview(groupId, input);
    return {
      baseGroupScore: preview.baseGroupScore,
      students: preview.students,
      rubricWeights: input.rubricWeights || { deliverables: {} },
      createdAt: preview.createdAt,
      groupId: preview.groupId,
    };
  } catch (error) {
    if (error instanceof PreviewError) {
      throw error;
    }
    throw new PreviewError(error.message || 'Failed to generate preview', error.status || 500);
  }
}

const finalGradePreviewService = {
  calculator: new FinalGradeCalculationService(),
  previewGroupGrade: generatePreview,
};

module.exports = {
  ...finalGradePreviewService,
  buildFinalGradesPreview,
  generatePreview,
  PreviewError,
};
