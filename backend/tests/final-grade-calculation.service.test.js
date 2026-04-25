'use strict';

const {
  FinalGradeCalculationService,
} = require('../src/services/finalGradeCalculationService');

describe('FinalGradeCalculationService.computeFinalGrades', () => {
  let service;

  beforeEach(() => {
    service = new FinalGradeCalculationService();
  });

  it('matches golden fixture exactly for fixed inputs', () => {
    const result = service.computeFinalGrades(
      85,
      [{ studentId: 'stu_1', ratio: 1.1 }],
      {
        deliverableWeights: { d1: 70 },
        sprintWeights: { s1: 30 },
      }
    );

    expect(result).toEqual({
      baseGroupScore: 85,
      students: [
        {
          studentId: 'stu_1',
          contributionRatio: 1.1,
          computedFinalGrade: 93.5,
        },
      ],
    });
  });

  it('maintains the same base score when rubric weights change (already weighted)', () => {
    const baseInput = 80;
    const ratios = [{ studentId: 'stu_1', ratio: 1.25 }];

    const result100 = service.computeFinalGrades(baseInput, ratios, {
      deliverableWeights: { d1: 60 },
      sprintWeights: { s1: 40 },
    });

    const result125 = service.computeFinalGrades(baseInput, ratios, {
      deliverableWeights: { d1: 75 },
      sprintWeights: { s1: 50 },
    });

    // baseGroupScore is already weighted, so multiplier is 1.
    // final grade = 80 * 1.25 = 100 for both.
    expect(result100.students[0].computedFinalGrade).toBe(100);
    expect(result125.students[0].computedFinalGrade).toBe(100);
  });

  it('defaults missing ratio to 1.0', () => {
    const result = service.computeFinalGrades(
      90,
      [{ studentId: 'stu_missing_ratio' }],
      {
        deliverableWeights: { d1: 100 },
      }
    );

    expect(result.students[0].contributionRatio).toBe(1);
    expect(result.students[0].computedFinalGrade).toBe(90);
  });

  it('handles edge case ratio 0 correctly', () => {
    const result = service.computeFinalGrades(
      88,
      [{ studentId: 'stu_zero', ratio: 0 }],
      {
        deliverableWeights: { d1: 100 },
      }
    );

    expect(result.students[0].computedFinalGrade).toBe(0);
  });

  it('handles outlier high ratio without NaN/Infinity', () => {
    const result = service.computeFinalGrades(
      100,
      [{ studentId: 'stu_outlier', ratio: 9.999 }],
      {
        deliverableWeights: { d1: 100 },
      }
    );

    expect(Number.isFinite(result.students[0].computedFinalGrade)).toBe(true);
    expect(result.students[0].computedFinalGrade).toBe(1000);
  });

  it('never returns NaN/Infinity when inputs are invalid', () => {
    const result = service.computeFinalGrades(
      Number.POSITIVE_INFINITY,
      [
        { studentId: 'stu_nan', ratio: Number.NaN },
        { studentId: 'stu_inf', ratio: Number.POSITIVE_INFINITY },
      ],
      {
        deliverableWeights: { d1: Number.NaN },
        sprintWeights: { s1: Number.POSITIVE_INFINITY },
      }
    );

    expect(Number.isFinite(result.baseGroupScore)).toBe(true);
    result.students.forEach((student) => {
      expect(Number.isFinite(student.contributionRatio)).toBe(true);
      expect(Number.isFinite(student.computedFinalGrade)).toBe(true);
    });
  });

  it('rounds deterministically to two decimals', () => {
    const result = service.computeFinalGrades(
      83.335,
      [{ studentId: 'stu_round', ratio: 1.005 }],
      {
        deliverableWeights: { d1: 100 },
      }
    );

    expect(result.baseGroupScore).toBe(83.34);
    expect(result.students[0].contributionRatio).toBe(1.01);
    // 83.34 * 1.01 = 84.1734 -> 84.17
    expect(result.students[0].computedFinalGrade).toBe(84.17);
  });

  it('keeps final grade out of 100 when total weights sum to 200', () => {
    const result = service.computeFinalGrades(
      100, // max base score
      [{ studentId: 'stu_1', ratio: 1.0 }],
      {
        deliverableWeights: { d1: 100 },
        sprintWeights: { s1: 100 },
      }
    );

    expect(result.baseGroupScore).toBe(100);
    expect(result.students[0].computedFinalGrade).toBe(100);
  });

  it('handles zero total weight and empty arrays without NaN/Infinity', () => {
    const result = service.computeFinalGrades(
      85,
      [],
      {
        deliverableWeights: { d1: 0 },
        sprintWeights: { s1: 0 },
      }
    );
    expect(result.baseGroupScore).toBe(85);
    expect(Array.isArray(result.students)).toBe(true);
    expect(result.students.length).toBe(0);
  });

  it('keeps computation stable with sprint-only weights', () => {
    const result = service.computeFinalGrades(
      91.25,
      [{ studentId: 'stu_sprint_only', ratio: 1.02 }],
      {
        deliverableWeights: {},
        sprintWeights: { s1: 60, s2: 40 },
      }
    );

    expect(result.baseGroupScore).toBe(91.25);
    expect(result.students[0].contributionRatio).toBe(1.02);
    expect(result.students[0].computedFinalGrade).toBe(93.08);
  });

  it('returns multiplier 1.0 behavior even with negative weights', () => {
    const result = service.computeFinalGrades(
      75,
      [{ studentId: 'stu_negative_weight', ratio: 1 }],
      {
        deliverableWeights: { d1: -30 },
        sprintWeights: { s1: 130 },
      }
    );

    expect(result.baseGroupScore).toBe(75);
    expect(result.students[0].computedFinalGrade).toBe(75);
    expect(Number.isFinite(result.students[0].computedFinalGrade)).toBe(true);
  });

  it('handles extreme zeroes with baseGroupScore=0 and ratio=0', () => {
    const result = service.computeFinalGrades(
      0,
      [{ studentId: 'stu_zero_extreme', ratio: 0 }],
      {
        deliverableWeights: { d1: 100 },
      }
    );

    expect(result.baseGroupScore).toBe(0);
    expect(result.students[0].contributionRatio).toBe(0);
    expect(result.students[0].computedFinalGrade).toBe(0);
  });

  it('includes groupId when optional context is provided', () => {
    const result = service.computeFinalGrades(
      88,
      [{ studentId: 'stu_group_context', ratio: 1 }],
      { deliverableWeights: { d1: 100 } },
      { groupId: 'grp_001' }
    );

    expect(result.groupId).toBe('grp_001');
    expect(result.baseGroupScore).toBe(88);
    expect(result.students[0].computedFinalGrade).toBe(88);
  });
});
