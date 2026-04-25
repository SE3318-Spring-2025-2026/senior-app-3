'use strict';

const {
  normalizeRatio,
  clampRatio,
  validateRatioSum,
  formatRatio,
  calculateFallbackRatio,
} = require('../src/utils/ratioNormalization');
const {
  normalizeGroupRatios,
  generateSummary,
  RatioServiceError,
} = require('../src/services/contributionRatioService');

describe('Issue #247 - pure ratio calculations', () => {
  test('golden normalized output for a two-member group', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 5, existingRecord: null },
      { studentId: 'student-2', storyPointsCompleted: 15, existingRecord: null },
    ];
    const targetMap = new Map([
      ['student-1', 10],
      ['student-2', 10],
    ]);

    const result = normalizeGroupRatios(contributions, targetMap);

    expect(result).toEqual([
      expect.objectContaining({ studentId: 'student-1', ratio: 0.25, targetUsed: 10, completed: 5 }),
      expect.objectContaining({ studentId: 'student-2', ratio: 0.75, targetUsed: 10, completed: 15 }),
    ]);
    expect(result.reduce((sum, item) => sum + item.ratio, 0)).toBe(1);
  });

  test('golden normalized output for a three-member group with fixed expected ratios', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 3, existingRecord: null },
      { studentId: 'student-2', storyPointsCompleted: 8, existingRecord: null },
      { studentId: 'student-3', storyPointsCompleted: 13, existingRecord: null },
    ];
    const targetMap = new Map([
      ['student-1', 13],
      ['student-2', 13],
      ['student-3', 13],
    ]);

    const result = normalizeGroupRatios(contributions, targetMap);
    expect(result.map(item => item.ratio)).toEqual([0.125, 0.3333, 0.5417]);
    expect(result.reduce((sum, item) => sum + item.ratio, 0).toFixed(4)).toBe('1.0000');
  });

  test('throws safe error for zero group totals', () => {
    expect(() =>
      normalizeGroupRatios(
        [
          { studentId: 'student-1', storyPointsCompleted: 0 },
          { studentId: 'student-2', storyPointsCompleted: 0 },
        ],
        new Map([
          ['student-1', 10],
          ['student-2', 10],
        ])
      )
    ).toThrow(expect.objectContaining({ code: 'ZERO_GROUP_TOTAL' }));
  });

  test('throws safe error for invalid normalization factors', () => {
    const contributions = [{ studentId: 'student-1', storyPointsCompleted: 5 }];
    const targetMap = new Map([['student-1', 10]]);

    expect(() => normalizeGroupRatios(contributions, targetMap, 0)).toThrow(
      expect.objectContaining({ code: 'INVALID_NORMALIZATION_FACTOR' })
    );
    expect(() => normalizeGroupRatios(contributions, targetMap, 2)).toThrow(
      expect.objectContaining({ code: 'INVALID_NORMALIZATION_FACTOR' })
    );
  });

  test('covers existing pure math helpers for zero or invalid targets', () => {
    expect(normalizeRatio(5, 0, 10, 'fixed')).toBeNull();
    expect(normalizeRatio(5, -4, 10, 'fixed')).toBeNull();
    expect(normalizeRatio(5, 10, 0, 'weighted')).toBe(0.5);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
    expect(formatRatio(Number.NaN)).toBe(0);
    expect(calculateFallbackRatio(8, 24, 3)).toBeCloseTo(1, 10);
    expect(calculateFallbackRatio(8, 24, 0)).toBeNull();
    expect(validateRatioSum([0.125, 0.3333, 0.5417])).toEqual(
      expect.objectContaining({ valid: true, actualSum: 1 })
    );
  });

  test('throws for invalid ratio strategy', () => {
    expect(() => normalizeRatio(5, 10, 10, 'mystery')).toThrow("Invalid ratio strategy: 'mystery'. Must be 'fixed', 'weighted', or 'normalized'.");
  });

  test('generateSummary returns expected aggregate fields', () => {
    const ratios = [
      { studentId: 'student-1', ratio: 0.25, targetUsed: 10, completed: 5 },
      { studentId: 'student-2', ratio: 0.75, targetUsed: 10, completed: 15 },
    ];

    const summary = generateSummary('group-1', 'sprint-1', ratios, 20, new Date('2026-01-01T00:00:00.000Z'), 0);

    expect(summary).toEqual(
      expect.objectContaining({
        groupId: 'group-1',
        sprintId: 'sprint-1',
        groupTotalStoryPoints: 20,
        strategy: 'normalized',
      })
    );
    expect(summary.contributions).toEqual([
      expect.objectContaining({ studentId: 'student-1', contributionRatio: 0.25, percentageOfGroup: '25.00%' }),
      expect.objectContaining({ studentId: 'student-2', contributionRatio: 0.75, percentageOfGroup: '75.00%' }),
    ]);
    expect(summary.summary).toEqual({
      totalMembers: 2,
      averageRatio: '0.5000',
      maxRatio: '0.7500',
      minRatio: '0.2500',
      normalizationFactor: '1.0000',
    });
  });

  test('preserves normalization under rounding-sensitive remainder distribution', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 1 },
      { studentId: 'student-2', storyPointsCompleted: 1 },
      { studentId: 'student-3', storyPointsCompleted: 1 },
    ];
    const targetMap = new Map([
      ['student-1', 3],
      ['student-2', 3],
      ['student-3', 3],
    ]);

    const result = normalizeGroupRatios(contributions, targetMap);
    expect(result.map(item => item.ratio)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(validateRatioSum(result.map(item => item.ratio))).toEqual(
      expect.objectContaining({ valid: true, actualSum: 1 })
    );
  });

  test('is deterministic across repeated runs', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 11 },
      { studentId: 'student-2', storyPointsCompleted: 7 },
      { studentId: 'student-3', storyPointsCompleted: 5 },
    ];
    const targetMap = new Map([
      ['student-1', 10],
      ['student-2', 10],
      ['student-3', 10],
    ]);

    const baseline = normalizeGroupRatios(contributions, targetMap).map(item => item.ratio);
    for (let i = 0; i < 100; i += 1) {
      const current = normalizeGroupRatios(contributions, targetMap).map(item => item.ratio);
      expect(current).toEqual(baseline);
    }
  });

  test('normalizes non-finite and negative story points to zero contribution', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 'abc' },
      { studentId: 'student-2', storyPointsCompleted: Number.NaN },
      { studentId: 'student-3', storyPointsCompleted: -15 },
      { studentId: 'student-4', storyPointsCompleted: 9 },
    ];
    const targetMap = new Map([
      ['student-1', 10],
      ['student-2', 10],
      ['student-3', 10],
      ['student-4', 10],
    ]);

    const result = normalizeGroupRatios(contributions, targetMap);
    expect(result.map(item => item.ratio)).toEqual([0, 0, 0, 1]);
    expect(result.reduce((sum, item) => sum + item.ratio, 0).toFixed(4)).toBe('1.0000');
  });

  test('throws precise error when a student target is missing', () => {
    expect(() =>
      normalizeGroupRatios(
        [
          { studentId: 'student-1', storyPointsCompleted: 5 },
          { studentId: 'student-2', storyPointsCompleted: 5 },
        ],
        new Map([['student-1', 10]])
      )
    ).toThrow(expect.objectContaining({ code: 'MISSING_STUDENT_TARGET' }));
  });

  test('triggers unitsToDistribute < 0 correction path while preserving sum', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 8 },
      { studentId: 'student-2', storyPointsCompleted: 3 },
    ];
    const targetMap = new Map([
      ['student-1', 10],
      ['student-2', 10],
    ]);

    const result = normalizeGroupRatios(contributions, targetMap, 0.9999);
    expect(result.reduce((sum, item) => sum + item.ratio, 0).toFixed(4)).toBe('0.9999');
    expect(result.every(item => item.ratio >= 0 && item.ratio <= 1)).toBe(true);
  });

  test('clamps overflowed normalized shares to valid ratio bounds', () => {
    const contributions = [
      { studentId: 'student-1', storyPointsCompleted: 1000 },
      { studentId: 'student-2', storyPointsCompleted: 1 },
      { studentId: 'student-3', storyPointsCompleted: 1 },
      { studentId: 'student-4', storyPointsCompleted: 1 },
    ];
    const targetMap = new Map([
      ['student-1', 1],
      ['student-2', 1000],
      ['student-3', 1000],
      ['student-4', 1000],
    ]);

    const result = normalizeGroupRatios(contributions, targetMap, 1);
    expect(result.every(item => item.ratio >= 0 && item.ratio <= 1)).toBe(true);
    expect(result.reduce((sum, item) => sum + item.ratio, 0).toFixed(4)).toBe('1.0000');
  });

  test('throws NORMALIZATION_DRIFT when final sum integrity is compromised', () => {
    const contributions = [{ studentId: 'student-1', storyPointsCompleted: 5 }];
    const targetMap = new Map([['student-1', 10]]);

    expect(() => normalizeGroupRatios(contributions, targetMap, 1, { forceNormalizationDrift: true })).toThrow(
      expect.objectContaining({ code: 'NORMALIZATION_DRIFT' })
    );
  });

  test('ignores forceNormalizationDrift outside test environment', () => {
    const contributions = [{ studentId: 'student-1', storyPointsCompleted: 5 }];
    const targetMap = new Map([['student-1', 10]]);
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      expect(() => normalizeGroupRatios(contributions, targetMap, 1, { forceNormalizationDrift: true })).not.toThrow();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
