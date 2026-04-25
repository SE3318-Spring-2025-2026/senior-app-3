'use strict';

const path = require('path');
const fs = require('fs');
const {
  FinalGradeCalculationService,
  roundToTwoDecimals,
} = require('../src/services/finalGradeCalculationService');

// Regression Protection: Load golden fixtures at top-level for test.each availability
const fixturePath = path.join(__dirname, 'fixtures', 'final-grade-golden.json');
const goldenFixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

describe('Process 11 - Final Grade Golden Suite', () => {
  let service;

  beforeEach(() => {
    service = new FinalGradeCalculationService();
  });

  describe('golden fixtures (strict regression guard)', () => {
    test.each(goldenFixtures)('$name should match exactly', ({ input, expected }) => {
      const result = service.computeFinalGrades(
        input.baseGroupScore,
        [{ studentId: expected.studentId, ratio: input.ratio }],
        input.rubricWeights || {}
      );

      // Verify human-readable golden output matches exactly
      expect(result.students[0]).toEqual(expected);
      
      // Ensure base score was also handled correctly
      const expectedBase = input.rubricWeights && Array.isArray(input.rubricWeights)
        ? roundToTwoDecimals(input.baseGroupScore * input.rubricWeights.reduce((a, b) => a + b, 0))
        : roundToTwoDecimals(input.baseGroupScore);
        
      expect(result.baseGroupScore).toBe(expectedBase);
    });
  });

  describe('edge case and safety auditing', () => {
    const edgeCases = [
      {
        name: 'zero ratio -> 0.00',
        baseGroupScore: 87.45,
        entry: { studentId: 'stu_zero_ratio', ratio: 0 },
        expected: {
          studentId: 'stu_zero_ratio',
          contributionRatio: 0,
          computedFinalGrade: 0,
        },
      },
      {
        name: 'zero base score -> 0.00',
        baseGroupScore: 0,
        entry: { studentId: 'stu_zero_base', ratio: 1.27 },
        expected: {
          studentId: 'stu_zero_base',
          contributionRatio: 1.27,
          computedFinalGrade: 0,
        },
      },
      {
        name: 'negative values clamped to 0',
        baseGroupScore: 70,
        entry: { studentId: 'stu_negative_ratio', ratio: -0.5 },
        expected: {
          studentId: 'stu_negative_ratio',
          contributionRatio: 0,
          computedFinalGrade: 0,
        },
      },
      {
        name: 'NaN/Malformed ratio defaults to 1.0',
        baseGroupScore: 80,
        entry: { studentId: 'stu_nan_ratio', ratio: Number.NaN },
        expected: {
          studentId: 'stu_nan_ratio',
          contributionRatio: 1,
          computedFinalGrade: 80,
        },
      },
      {
        name: 'localized comma decimal normalization',
        baseGroupScore: '85,5',
        entry: { studentId: 'stu_localized', ratio: 1.2 },
        expected: {
          studentId: 'stu_localized',
          contributionRatio: 1.2,
          computedFinalGrade: 102.6,
        },
      },
    ];

    test.each(edgeCases)('$name', ({ baseGroupScore, entry, expected }) => {
      const result = service.computeFinalGrades(baseGroupScore, [entry]);
      expect(result.students[0]).toEqual(expected);
      expect(result.students[0].computedFinalGrade >= 0).toBe(true);
    });
  });

  describe('deterministic rounding policy checks', () => {
    it('rounds 85.555 to 85.56 (Math.round half-up behavior)', () => {
      expect(roundToTwoDecimals(85.555)).toBe(85.56);
    });

    it('handles boundary micro-values deterministically', () => {
      expect(roundToTwoDecimals(0.005)).toBe(0.01);
      expect(roundToTwoDecimals(0.0049)).toBe(0);
    });
  });
});
