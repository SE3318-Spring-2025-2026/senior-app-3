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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundToTwoDecimals(value) {
  const safe = toFiniteNumber(value, 0);
  return Math.round((safe + Number.EPSILON) * ROUNDING_SCALE) / ROUNDING_SCALE;
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

module.exports = {
  FinalGradeCalculationService,
  roundToTwoDecimals,
  resolveRubricMultiplier,
};
