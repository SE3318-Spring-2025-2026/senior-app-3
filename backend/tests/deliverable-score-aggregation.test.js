'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../src/models/Deliverable', () => ({
  find: jest.fn(),
}));

jest.mock('../src/models/Review', () => ({
  find: jest.fn(),
}));

const Deliverable = require('../src/models/Deliverable');
const Review = require('../src/models/Review');
const {
  DeliverableScoreAggregationError,
  getDeliverableAggregateScoresForGroup,
} = require('../src/services/deliverableScoreAggregationService');

const makeDeliverable = (overrides = {}) => ({
  deliverableId: overrides.deliverableId || 'del_alpha',
  groupId: overrides.groupId || 'grp_score_1',
  committeeId: overrides.committeeId || 'com_score_1',
  deliverableType: overrides.deliverableType || 'proposal',
  sprintId: overrides.sprintId || 'sprint_1',
  submittedBy: overrides.submittedBy || 'stu_1',
  status: overrides.status || 'evaluated',
  submittedAt: overrides.submittedAt || new Date('2026-04-01T10:00:00.000Z'),
  ...overrides,
});

const makeReview = (overrides = {}) => ({
  reviewId: overrides.reviewId || `rev_${overrides.deliverableId || 'alpha'}`,
  deliverableId: overrides.deliverableId || 'del_alpha',
  groupId: overrides.groupId || 'grp_score_1',
  status: overrides.status || 'completed',
  assignedMembers: overrides.assignedMembers || [
    { memberId: 'prof_1', status: 'accepted' },
  ],
  evaluationScores: overrides.evaluationScores || [],
  aggregateScore: Object.prototype.hasOwnProperty.call(overrides, 'aggregateScore')
    ? overrides.aggregateScore
    : 80,
  evaluationCompletedAt: overrides.evaluationCompletedAt || new Date('2026-04-10T10:00:00.000Z'),
  updatedAt: overrides.updatedAt || new Date('2026-04-11T10:00:00.000Z'),
  ...overrides,
});

const mockDeliverables = (deliverables) => {
  const lean = jest.fn().mockResolvedValue(deliverables);
  const sort = jest.fn().mockReturnValue({ lean });

  Deliverable.find.mockReturnValue({ sort });
  return { sort, lean };
};

const mockReviews = (reviews) => {
  const lean = jest.fn().mockResolvedValue(reviews);

  Review.find.mockReturnValue({ lean });
  return { lean };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deliverableScoreAggregationService', () => {
  it('aggregates multiple evaluated deliverables into a base group score', async () => {
    mockDeliverables([
      makeDeliverable({ deliverableId: 'del_alpha', deliverableType: 'proposal' }),
      makeDeliverable({ deliverableId: 'del_beta', deliverableType: 'final_report' }),
    ]);
    mockReviews([
      makeReview({ deliverableId: 'del_alpha', aggregateScore: 80 }),
      makeReview({ deliverableId: 'del_beta', aggregateScore: 90 }),
    ]);

    const result = await getDeliverableAggregateScoresForGroup('grp_score_1');

    expect(Deliverable.find).toHaveBeenCalledWith({ groupId: 'grp_score_1' });
    expect(Review.find).toHaveBeenCalledWith({
      groupId: 'grp_score_1',
      deliverableId: { $in: ['del_alpha', 'del_beta'] },
    });
    expect(result.groupId).toBe('grp_score_1');
    expect(result.baseGroupScore).toBe(85);
    expect(result.deliverableScoreBreakdown).toEqual({
      del_alpha: 80,
      del_beta: 90,
    });
    expect(result.auditTrail).toHaveLength(2);
    expect(result.auditTrail[0]).toMatchObject({
      deliverableId: 'del_alpha',
      reviewId: 'rev_del_alpha',
      score: 80,
      scoreSource: 'aggregateScore',
      reviewerIds: ['prof_1'],
    });
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('uses aggregateScore directly when present', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_direct' })]);
    mockReviews([
      makeReview({
        deliverableId: 'del_direct',
        aggregateScore: 77.777,
        evaluationScores: [
          { criterion: 'Ignored row', score: 10, maxScore: 100, weight: 1, ratedBy: 'prof_2' },
        ],
      }),
    ]);

    const result = await getDeliverableAggregateScoresForGroup('grp_score_1');

    expect(result.baseGroupScore).toBe(77.78);
    expect(result.deliverableScoreBreakdown.del_direct).toBe(77.78);
    expect(result.auditTrail[0].scoreSource).toBe('aggregateScore');
  });

  it('falls back to weighted evaluationScores when aggregateScore is absent', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_weighted' })]);
    mockReviews([
      makeReview({
        deliverableId: 'del_weighted',
        aggregateScore: null,
        evaluationScores: [
          { criterion: 'Design', score: 8, maxScore: 10, weight: 2, ratedBy: 'prof_1' },
          { criterion: 'Implementation', score: 45, maxScore: 50, weight: 1, ratedBy: 'prof_2' },
        ],
      }),
    ]);

    const result = await getDeliverableAggregateScoresForGroup('grp_score_1');

    expect(result.baseGroupScore).toBe(83.33);
    expect(result.deliverableScoreBreakdown.del_weighted).toBe(83.33);
    expect(result.auditTrail[0]).toMatchObject({
      scoreSource: 'evaluationScores',
      reviewerIds: ['prof_1', 'prof_2'],
    });
  });

  it('filters by includeDeliverableIds and keeps output stable', async () => {
    mockDeliverables([
      makeDeliverable({ deliverableId: 'del_keep' }),
    ]);
    mockReviews([
      makeReview({ deliverableId: 'del_keep', aggregateScore: 95 }),
    ]);

    const result = await getDeliverableAggregateScoresForGroup('grp_score_1', {
      includeDeliverableIds: ['del_keep'],
    });

    expect(Deliverable.find).toHaveBeenCalledWith({
      groupId: 'grp_score_1',
      deliverableId: { $in: ['del_keep'] },
    });
    expect(result.baseGroupScore).toBe(95);
    expect(result.deliverableScoreBreakdown).toEqual({ del_keep: 95 });
    expect(result.auditTrail.map((entry) => entry.deliverableId)).toEqual(['del_keep']);
  });

  it('throws 409 when a required deliverable has no review', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_no_review' })]);
    mockReviews([]);

    await expect(getDeliverableAggregateScoresForGroup('grp_score_1')).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'INCOMPLETE_DELIVERABLE_EVALUATION',
      details: { deliverableId: 'del_no_review' },
    });
  });

  it('throws 409 when a review is not completed', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_pending' })]);
    mockReviews([
      makeReview({
        deliverableId: 'del_pending',
        status: 'in_progress',
        aggregateScore: 88,
      }),
    ]);

    await expect(getDeliverableAggregateScoresForGroup('grp_score_1')).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'INCOMPLETE_DELIVERABLE_EVALUATION',
      details: {
        deliverableId: 'del_pending',
        status: 'in_progress',
      },
    });
  });

  it('throws 409 when a completed review lacks usable scores', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_no_scores' })]);
    mockReviews([
      makeReview({
        deliverableId: 'del_no_scores',
        aggregateScore: null,
        evaluationScores: [],
      }),
    ]);

    await expect(getDeliverableAggregateScoresForGroup('grp_score_1')).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'MISSING_DELIVERABLE_SCORE',
      details: { deliverableId: 'del_no_scores' },
    });
  });

  it('throws 404 when requested deliverable IDs are not found for the group', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_existing' })]);
    mockReviews([makeReview({ deliverableId: 'del_existing', aggregateScore: 80 })]);

    await expect(
      getDeliverableAggregateScoresForGroup('grp_score_1', {
        includeDeliverableIds: ['del_existing', 'del_missing'],
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'REQUESTED_DELIVERABLES_NOT_FOUND',
      details: { missingDeliverableIds: ['del_missing'] },
    });
  });

  it('throws 404 with requested IDs when all filtered deliverables are missing', async () => {
    mockDeliverables([]);

    await expect(
      getDeliverableAggregateScoresForGroup('grp_score_1', {
        includeDeliverableIds: ['del_missing'],
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'REQUESTED_DELIVERABLES_NOT_FOUND',
      details: { missingDeliverableIds: ['del_missing'] },
    });
    expect(Review.find).not.toHaveBeenCalled();
  });

  it('throws 400 for invalid includeDeliverableIds filters', async () => {
    await expect(
      getDeliverableAggregateScoresForGroup('grp_score_1', { includeDeliverableIds: [] })
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_DELIVERABLE_FILTER',
    });
  });

  it('throws 400 for invalid score ranges', async () => {
    mockDeliverables([makeDeliverable({ deliverableId: 'del_bad_score' })]);
    mockReviews([
      makeReview({
        deliverableId: 'del_bad_score',
        aggregateScore: null,
        evaluationScores: [
          { criterion: 'Design', score: 120, maxScore: 100, weight: 1, ratedBy: 'prof_1' },
        ],
      }),
    ]);

    await expect(getDeliverableAggregateScoresForGroup('grp_score_1')).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_EVALUATION_SCORE',
      details: {
        deliverableId: 'del_bad_score',
        criterion: 'Design',
      },
    });
  });

  it('exports a typed aggregation error for controller error mapping', () => {
    const error = new DeliverableScoreAggregationError('test', 409, 'TEST_CODE');

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('TEST_CODE');
  });
});
