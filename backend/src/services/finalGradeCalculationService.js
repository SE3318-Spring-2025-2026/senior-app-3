'use strict';

/**
 * rounds a number to two decimals.
 */
function roundToTwoDecimals(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Resolves the rubric multiplier ensuring it does not result in doubling.
 * Issue #250 Fix: Normalizes the weights so the sum does not exceed 1.0 (100%).
 * If the score is already weighted (isAlreadyWeighted = true), it returns 1.0 to avoid double weighting.
 */
function resolveRubricMultiplier(weights = [], isAlreadyWeighted = false) {
  if (isAlreadyWeighted) {
    return 1.0;
  }
  
  if (!weights || weights.length === 0) {
    return 1.0;
  }
  
  let totalWeight = weights.reduce((acc, val) => acc + val, 0);
  
  // If weights are provided as percentages (e.g. 100 instead of 1.0)
  if (totalWeight > 1.0) {
    totalWeight = totalWeight / 100.0;
  }
  
  // Cap at 1.0
  if (totalWeight > 1.0) {
    return 1.0;
  }
  
  return totalWeight;
}

/**
 * Calculates the final grade preview for the group and its students.
 */
function calculateFinalGrades(groupId, baseGroupScore, records, options = {}) {
  const { weights = [], isAlreadyWeighted = false } = options;
  
  const multiplier = resolveRubricMultiplier(weights, isAlreadyWeighted);
  const adjustedBaseScore = baseGroupScore * multiplier;

  const studentGrades = new Map();
  let totalRatio = 0;

  for (const record of records) {
    const { studentId, contributionRatio } = record;
    const rawRatio = contributionRatio || 0;
    
    totalRatio += rawRatio;
    
    // Fix: Use the rounded safeRatio for computation to avoid rounding inconsistencies
    const safeRatio = roundToTwoDecimals(rawRatio);
    const computedFinalGrade = roundToTwoDecimals(adjustedBaseScore * safeRatio);

    if (!studentGrades.has(studentId)) {
      studentGrades.set(studentId, {
        studentId,
        contributionRatio: safeRatio,
        computedFinalGrade: computedFinalGrade,
        deliverableScoreBreakdown: {}
      });
    }
  }

  // Ensure total ratio is valid
  if (totalRatio > 0 && Math.abs(totalRatio - 1.0) > 0.01) {
    throw new Error('Inconsistent Configuration: ratios do not sum to 1.0');
  }

  return {
    groupId,
    baseGroupScore: roundToTwoDecimals(adjustedBaseScore),
    students: Array.from(studentGrades.values()),
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  calculateFinalGrades,
  resolveRubricMultiplier,
  roundToTwoDecimals
};
