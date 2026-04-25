'use strict';

const {
  validateContributionRecalculationBoundary,
  RatioServiceError,
} = require('../src/services/contributionRatioService');

describe('Issue #247 - pure recalculation boundary validation', () => {
  test('throws SPRINT_LOCKED for locked sprint', () => {
    expect(() =>
      validateContributionRecalculationBoundary({
        sprintLocked: true,
        configPublished: true,
        scheduleWindowOpen: true,
      })
    ).toThrow(expect.objectContaining({ code: 'SPRINT_LOCKED' }));
  });

  test('throws CONFIG_UNPUBLISHED for unpublished configuration', () => {
    try {
      validateContributionRecalculationBoundary({
        sprintLocked: false,
        configPublished: false,
        scheduleWindowOpen: true,
      });
      fail('Expected CONFIG_UNPUBLISHED');
    } catch (error) {
      expect(error).toBeInstanceOf(RatioServiceError);
      expect(error.code).toBe('CONFIG_UNPUBLISHED');
      expect(error.status).toBe(422);
    }
  });

  test('throws SPRINT_WINDOW_CLOSED for closed schedule window', () => {
    expect(() =>
      validateContributionRecalculationBoundary({
        sprintLocked: false,
        configPublished: true,
        scheduleWindowOpen: false,
      })
    ).toThrow(expect.objectContaining({ code: 'SPRINT_WINDOW_CLOSED' }));
  });

  test('does not throw when recalculation boundary is valid', () => {
    expect(() =>
      validateContributionRecalculationBoundary({
        sprintLocked: false,
        configPublished: true,
        scheduleWindowOpen: true,
      })
    ).not.toThrow();
  });
});
