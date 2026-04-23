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

  it('changes preview linearly when rubric weights change', () => {
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

    expect(result100.students[0].computedFinalGrade).toBe(100);
    expect(result125.students[0].computedFinalGrade).toBe(125);
    expect(result125.students[0].computedFinalGrade).toBe(
      result100.students[0].computedFinalGrade * 1.25
    );
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
    expect(result.students[0].computedFinalGrade).toBe(999.9);
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
    expect(result.students[0].computedFinalGrade).toBe(83.76);
  });
});
