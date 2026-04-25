'use strict';

/**
 * @typedef {Object} StudentRatio
 * @property {string} studentId
 * @property {number} [ratio]
 * @property {number} [contributionRatio]
 *
 * @typedef {Object} FinalGradePreviewEntry
 * @property {string} studentId
 * @property {number} contributionRatio
 * @property {number} computedFinalGrade
 *
 * @typedef {Object} FinalGradesPreview
 * @property {string} [groupId]
 * @property {number} baseGroupScore
 * @property {FinalGradePreviewEntry[]} students
 */
const DEFAULT_RATIO = 1.0;
const ROUNDING_SCALE = 100;
let structuredLogger = null;

try {
  ({ structuredLogger } = require('../utils/structuredLogger'));
} catch (_error) {
  structuredLogger = null;
}

function toFiniteNumber(value, fallback = 0) {
  let candidate = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    // Accept localized decimal commas (e.g. "85,5" -> "85.5")
    candidate = trimmed.includes(',') ? trimmed.replace(',', '.') : trimmed;
  }
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundToTwoDecimals(value) {
  const safe = toFiniteNumber(value, 0);
  const normalized = safe.toFixed(12);
  const isNegative = normalized.startsWith('-');
  const unsigned = isNegative ? normalized.slice(1) : normalized;
  const [wholePartRaw = '0', fractionRaw = ''] = unsigned.split('.');
  const fraction = (fractionRaw + '000').slice(0, 3);
  const firstTwo = Number(fraction.slice(0, 2));
  const thirdDigit = Number(fraction[2]);

  let wholePart = Number(wholePartRaw);
  let cents = firstTwo + (thirdDigit >= 5 ? 1 : 0);
  if (cents >= ROUNDING_SCALE) {
    wholePart += 1;
    cents -= ROUNDING_SCALE;
  }

  const rounded = wholePart + cents / ROUNDING_SCALE;
  const signed = isNegative ? -rounded : rounded;
  return Object.is(signed, -0) ? 0 : signed;
}

function hasNegativeWeightValues(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((entry) => {
    if (entry && typeof entry === 'object') {
      return hasNegativeWeightValues(entry);
    }

    const numeric = Number(entry);
    return Number.isFinite(numeric) && numeric < 0;
  });
}

function resolveRubricMultiplier(rubricWeights) {
  if (Array.isArray(rubricWeights)) {
    if (rubricWeights.length === 0) {
      return 1.0;
    }
    let totalWeight = rubricWeights.reduce((acc, val) => acc + toFiniteNumber(val, 0), 0);
    if (totalWeight > 1.0) {
      totalWeight = totalWeight / 100.0;
    }
    return totalWeight > 1.0 ? 1.0 : totalWeight;
  }

  if (hasNegativeWeightValues(rubricWeights)) {
    const warningContext = {
      event: 'final_grade_negative_rubric_weight_detected',
      rubricWeights,
    };

    if (structuredLogger && typeof structuredLogger.warn === 'function') {
      structuredLogger.warn(warningContext);
    } else {
      console.warn('[finalGradeCalculationService] negative rubric weights detected', warningContext);
    }
  }

  // Per Process 8.1/8.2, baseGroupScore is already weighted.
  // Returning 1.0 prevents double-weighting in Process 8.3.
  return 1.0;
}

class FinalGradeCalculationService {
  /**
   * @param {number} baseGroupScore
   * @param {StudentRatio[]} ratios
   * @param {object} rubricWeights
   * @param {string|{groupId?: string}} [groupContext]
   * @returns {FinalGradesPreview}
   */
  computeFinalGrades(baseGroupScore, ratios = [], rubricWeights = {}, groupContext) {
    const safeBaseGroupScore = toFiniteNumber(baseGroupScore, 0);
    const rubricMultiplier = resolveRubricMultiplier(rubricWeights);
    const adjustedBaseScore = roundToTwoDecimals(safeBaseGroupScore * rubricMultiplier);
    const resolvedGroupId =
      typeof groupContext === 'string'
        ? groupContext
        : typeof groupContext?.groupId === 'string'
          ? groupContext.groupId
          : null;

    const students = (Array.isArray(ratios) ? ratios : []).map((entry) => {
      const rawRatio = toFiniteNumber(
        entry?.ratio ?? entry?.contributionRatio,
        DEFAULT_RATIO
      );
      const safeRatio = roundToTwoDecimals(rawRatio);
      // Senkronizasyon: Yuvarlanmış değeri hem çıktı hem de hesaplama için ortak kullanıyoruz
      const computedFinalGrade = roundToTwoDecimals(adjustedBaseScore * safeRatio);

      return {
        studentId: entry?.studentId || '',
        contributionRatio: safeRatio,
        computedFinalGrade,
      };
    });

    // Veri Yapısı Mimari Kararı: Pure function sadece hesaplama sonucunu dönmeli.
    // groupId gibi meta veriler controller/orchestrator katmanında eklenmelidir.
    const result = {
      baseGroupScore: adjustedBaseScore,
      students,
    };

    if (resolvedGroupId) {
      result.groupId = resolvedGroupId;
    }

    return result;
  }
}

function calculateFinalGrades(groupId, baseGroupScore, records = [], options = {}) {
  const { weights = [], isAlreadyWeighted = false } = options;
  const RATIO_SUM_EPSILON = 0.0001;
  const service = new FinalGradeCalculationService();

  const normalizedRatios = records.map((record) => {
    const studentId = record?.studentId;
    if (!studentId) {
      throw new Error('Inconsistent Configuration: missing studentId in contribution records');
    }
    const rawRatio = toFiniteNumber(record?.contributionRatio, 0);
    return {
      studentId,
      contributionRatio: roundToTwoDecimals(rawRatio),
    };
  });

  const totalRatio = normalizedRatios.reduce((sum, entry) => sum + entry.contributionRatio, 0);
  if (Math.abs(totalRatio) <= RATIO_SUM_EPSILON) {
    throw new Error('Inconsistent Configuration: ratios sum to 0.0');
  }
  if (Math.abs(totalRatio - 1.0) > RATIO_SUM_EPSILON) {
    throw new Error('Inconsistent Configuration: ratios do not sum to 1.0');
  }

  const rubricWeights = isAlreadyWeighted ? {} : weights;
  const result = service.computeFinalGrades(baseGroupScore, normalizedRatios, rubricWeights, {
    groupId,
  });

  return {
    groupId,
    baseGroupScore: result.baseGroupScore,
    students: result.students.map((student) => ({
      ...student,
      deliverableScoreBreakdown: {},
    })),
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  FinalGradeCalculationService,
  calculateFinalGrades,
  roundToTwoDecimals,
  resolveRubricMultiplier,
};
