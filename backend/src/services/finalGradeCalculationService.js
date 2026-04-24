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
 * @property {number} baseGroupScore
 * @property {FinalGradePreviewEntry[]} students
 */

const DEFAULT_RATIO = 1.0;
const ROUNDING_SCALE = 100;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundToTwoDecimals(value) {
  const safe = toFiniteNumber(value, 0);
  return Math.round((safe + Number.EPSILON) * ROUNDING_SCALE) / ROUNDING_SCALE;
}

function sumWeightBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') {
    return 0;
  }

  return Object.values(bucket).reduce((total, current) => {
    return total + toFiniteNumber(current, 0);
  }, 0);
}

function resolveRubricMultiplier(rubricWeights) {
  if (!rubricWeights || typeof rubricWeights !== 'object') {
    return 1;
  }

  const deliverableWeights =
    rubricWeights.deliverableWeights || rubricWeights.deliverables || {};
  const sprintWeights =
    rubricWeights.sprintWeights || rubricWeights.sprints || {};

  const deliverableTotal = sumWeightBucket(deliverableWeights);
  const sprintTotal = sumWeightBucket(sprintWeights);
  const totalWeight = deliverableTotal + sprintTotal;

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return 1;
  }

  // OpenAPI Uyumu: baseGroupScore halihazırda weighted (ağırlıklandırılmış) bir puandır.
  // Bu nedenle, ağırlıkların toplamını yine ağırlıkların toplamına bölerek (weighted average mantığı)
  // çarpanı 1.0 olarak sabitliyoruz. Serviste tekrar ağırlık uygulamıyoruz.
  return totalWeight / totalWeight;
}

class FinalGradeCalculationService {
  /**
   * @param {number} baseGroupScore
   * @param {StudentRatio[]} ratios
   * @param {object} rubricWeights
   * @returns {FinalGradesPreview}
   */
  computeFinalGrades(baseGroupScore, ratios = [], rubricWeights = {}) {
    const safeBaseGroupScore = toFiniteNumber(baseGroupScore, 0);
    const rubricMultiplier = resolveRubricMultiplier(rubricWeights);
    const adjustedBaseScore = roundToTwoDecimals(safeBaseGroupScore * rubricMultiplier);

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
    return {
      baseGroupScore: adjustedBaseScore,
      students,
    };
  }
}

module.exports = {
  FinalGradeCalculationService,
  roundToTwoDecimals,
  resolveRubricMultiplier,
};
