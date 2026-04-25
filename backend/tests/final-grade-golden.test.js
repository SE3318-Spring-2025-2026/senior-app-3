'use strict';

const {
  FinalGradeCalculationService,
  roundToTwoDecimals,
} = require('../src/services/finalGradeCalculationService');

describe('Process 11 - Final Grade Golden Suite', () => {
  let service;

  beforeEach(() => {
    service = new FinalGradeCalculationService();
  });

  describe('golden fixtures (strict regression guard)', () => {
    const goldenFixtures = [
      {
        name: 'Fixture A (Standard)',
        input: { baseGroupScore: 80, ratio: 1.1 },
        expected: {
          studentId: 'stu_standard',
          contributionRatio: 1.1,
          computedFinalGrade: 88.0,
        },
      },
      {
        name: 'Fixture B (Precision)',
        input: { baseGroupScore: 75.5, ratio: 0.95 },
        expected: {
          studentId: 'stu_precision',
          contributionRatio: 0.95,
          computedFinalGrade: 71.73,
        },
      },
      {
        name: 'Fixture C (Outlier)',
        input: { baseGroupScore: 90, ratio: 1.25 },
        expected: {
          studentId: 'stu_outlier',
          contributionRatio: 1.25,
          computedFinalGrade: 112.5,
        },
      },
    ];

    test.each(goldenFixtures)('$name should match exactly', ({ input, expected }) => {
      const result = service.computeFinalGrades(input.baseGroupScore, [
        { studentId: expected.studentId, ratio: input.ratio },
      ]);

      expect(result).toEqual({
        baseGroupScore: roundToTwoDecimals(input.baseGroupScore),
        students: [expected],
      });
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
        name: 'missing ratio undefined defaults to 1.0',
        baseGroupScore: 73.42,
        entry: { studentId: 'stu_missing_ratio_undefined' },
        expected: {
          studentId: 'stu_missing_ratio_undefined',
          contributionRatio: 1,
          computedFinalGrade: 73.42,
        },
      },
      {
        name: 'missing ratio null defaults to 1.0',
        baseGroupScore: 73.42,
        entry: { studentId: 'stu_missing_ratio_null', ratio: null },
        expected: {
          studentId: 'stu_missing_ratio_null',
          contributionRatio: 1,
          computedFinalGrade: 73.42,
        },
      },
      {
        name: 'NaN ratio defaults to 1.0',
        baseGroupScore: 80,
        entry: { studentId: 'stu_nan_ratio', ratio: Number.NaN },
        expected: {
          studentId: 'stu_nan_ratio',
          contributionRatio: 1,
          computedFinalGrade: 80,
        },
      },
      {
        name: 'Infinity ratio defaults to 1.0',
        baseGroupScore: 80,
        entry: { studentId: 'stu_infinity_ratio', ratio: Number.POSITIVE_INFINITY },
        expected: {
          studentId: 'stu_infinity_ratio',
          contributionRatio: 1,
          computedFinalGrade: 80,
        },
      },
      {
        name: 'malformed base score string normalizes to 0',
        baseGroupScore: 'not-a-number',
        entry: { studentId: 'stu_bad_base_string', ratio: 1.2 },
        expected: {
          studentId: 'stu_bad_base_string',
          contributionRatio: 1.2,
          computedFinalGrade: 0,
        },
      },
      {
        name: 'localized comma decimal base score normalizes correctly',
        baseGroupScore: '85,5',
        entry: { studentId: 'stu_bad_base_localized', ratio: 1.2 },
        expected: {
          studentId: 'stu_bad_base_localized',
          contributionRatio: 1.2,
          computedFinalGrade: 102.6,
        },
      },
      {
        name: 'malformed base score NaN normalizes to 0',
        baseGroupScore: Number.NaN,
        entry: { studentId: 'stu_bad_base_nan', ratio: 1.2 },
        expected: {
          studentId: 'stu_bad_base_nan',
          contributionRatio: 1.2,
          computedFinalGrade: 0,
        },
      },
      {
        name: 'negative ratio remains finite',
        baseGroupScore: 70,
        entry: { studentId: 'stu_negative_ratio', ratio: -0.5 },
        expected: {
          studentId: 'stu_negative_ratio',
          contributionRatio: -0.5,
          computedFinalGrade: -35,
        },
      },
      {
        name: 'empty student object remains schema-safe',
        baseGroupScore: 66.66,
        entry: {},
        expected: {
          studentId: '',
          contributionRatio: 1,
          computedFinalGrade: 66.66,
        },
      },
      {
        name: 'contributionRatio field is accepted as fallback input',
        baseGroupScore: 85,
        entry: { studentId: 'stu_contrib_ratio', contributionRatio: 0.8 },
        expected: {
          studentId: 'stu_contrib_ratio',
          contributionRatio: 0.8,
          computedFinalGrade: 68,
        },
      },
    ];

    test.each(edgeCases)('$name', ({ baseGroupScore, entry, expected }) => {
      const result = service.computeFinalGrades(baseGroupScore, [entry]);
      expect(result.students[0]).toEqual(expected);
      expect(Number.isFinite(result.students[0].computedFinalGrade)).toBe(true);
      expect(Number.isFinite(result.students[0].contributionRatio)).toBe(true);
    });
  });

  describe('deterministic rounding policy checks', () => {
    it('rounds 85.555 to 85.56 (Math.round half-up behavior)', () => {
      expect(roundToTwoDecimals(85.555)).toBe(85.56);
    });

    it('handles boundary micro-values deterministically', () => {
      expect(roundToTwoDecimals(0.005)).toBe(0.01);
      expect(roundToTwoDecimals(0.0049)).toBe(0);
      expect(roundToTwoDecimals(-0.005)).toBe(-0.01);
      expect(roundToTwoDecimals(-0.0049)).toBe(0);
    });

    it('applies two-step deterministic rounding in full formula path', () => {
      const result = service.computeFinalGrades(77.777, [
        { studentId: 'stu_rounding_path', ratio: 1.1 },
      ]);

      expect(result).toEqual({
        baseGroupScore: 77.78,
        students: [
          {
            studentId: 'stu_rounding_path',
            contributionRatio: 1.1,
            computedFinalGrade: 85.56,
          },
        ],
      });
    });
  });

  describe('output schema contract (FinalGradePreviewEntry)', () => {
    it('returns exactly studentId, contributionRatio, computedFinalGrade', () => {
      const result = service.computeFinalGrades(82, [{ studentId: 'stu_schema', ratio: 1.05 }]);
      const entry = result.students[0];

      expect(entry).toEqual({
        studentId: 'stu_schema',
        contributionRatio: 1.05,
        computedFinalGrade: 86.1,
      });
      expect(Object.keys(entry).sort()).toEqual([
        'computedFinalGrade',
        'contributionRatio',
        'studentId',
      ]);
    });
  });
});
