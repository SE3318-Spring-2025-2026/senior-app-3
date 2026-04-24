const {
  calculateFinalGrades,
  resolveRubricMultiplier,
  roundToTwoDecimals
} = require('../src/services/finalGradeCalculationService');

describe('Final Grade Calculation Service', () => {
  describe('roundToTwoDecimals', () => {
    it('should correctly round numbers to two decimal places', () => {
      expect(roundToTwoDecimals(85.456)).toBe(85.46);
      expect(roundToTwoDecimals(85.454)).toBe(85.45);
      expect(roundToTwoDecimals(0)).toBe(0);
      expect(roundToTwoDecimals(1)).toBe(1);
    });
  });

  describe('resolveRubricMultiplier', () => {
    it('should return 1.0 if score is already weighted', () => {
      expect(resolveRubricMultiplier([50, 50], true)).toBe(1.0);
    });

    it('should return 1.0 if weights array is empty or undefined', () => {
      expect(resolveRubricMultiplier([], false)).toBe(1.0);
      expect(resolveRubricMultiplier(null, false)).toBe(1.0);
    });

    it('should correctly convert percentage sum to decimal and avoid doubling', () => {
      // weights sum to 100, so it should be 100/100 = 1.0
      expect(resolveRubricMultiplier([50, 30, 20], false)).toBe(1.0);
    });

    it('should cap at 1.0 even if total sum exceeds 100%', () => {
      expect(resolveRubricMultiplier([50, 60], false)).toBe(1.0);
    });
    
    it('should apply multiplier directly if weights sum to less than or equal to 1.0', () => {
      expect(resolveRubricMultiplier([0.3, 0.4], false)).toBe(0.7);
    });
  });

  describe('calculateFinalGrades', () => {
    it('should calculate baseGroupScore and individual grades using safe rounded ratios', () => {
      const records = [
        { studentId: 'studentA', contributionRatio: 0.3333333 },
        { studentId: 'studentB', contributionRatio: 0.6666666 }
      ];

      const result = calculateFinalGrades('group123', 85, records, {
        weights: [50, 50],
        isAlreadyWeighted: false
      });

      expect(result.groupId).toBe('group123');
      expect(result.baseGroupScore).toBe(85);

      const studentA = result.students.find(s => s.studentId === 'studentA');
      const studentB = result.students.find(s => s.studentId === 'studentB');

      // 0.3333333 gets rounded to 0.33
      expect(studentA.contributionRatio).toBe(0.33);
      // 85 * 0.33 = 28.05
      expect(studentA.computedFinalGrade).toBe(28.05);

      // 0.6666666 gets rounded to 0.67
      expect(studentB.contributionRatio).toBe(0.67);
      // 85 * 0.67 = 56.95
      expect(studentB.computedFinalGrade).toBe(56.95);
    });

    it('should throw an error if ratios do not sum to ~1.0', () => {
      const records = [
        { studentId: 'studentA', contributionRatio: 0.2 },
        { studentId: 'studentB', contributionRatio: 0.5 }
      ];

      expect(() => {
        calculateFinalGrades('group123', 85, records, {
          weights: [50, 50],
          isAlreadyWeighted: false
        });
      }).toThrow('Inconsistent Configuration: ratios do not sum to 1.0');
    });

    it('should not double the score when weights sum to 100', () => {
      const records = [
        { studentId: 'studentA', contributionRatio: 0.5 },
        { studentId: 'studentB', contributionRatio: 0.5 }
      ];

      // Base score 90. Without the fix, 90 * (100) / 100? or 90 * 2.0?
      // The issue said it was incorrectly doubling the score (2.0 çarpanı).
      // Here weights sum to 100, which gives multiplier 1.0, meaning score should remain 90.
      const result = calculateFinalGrades('group123', 90, records, {
        weights: [50, 50]
      });

      expect(result.baseGroupScore).toBe(90);
      expect(result.students[0].computedFinalGrade).toBe(45); // 90 * 0.5
      expect(result.students[1].computedFinalGrade).toBe(45); // 90 * 0.5
    });
  });
});
