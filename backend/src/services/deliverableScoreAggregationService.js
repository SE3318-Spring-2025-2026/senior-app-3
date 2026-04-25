'use strict';

const Deliverable = require('../models/Deliverable');
const Review = require('../models/Review');

class DeliverableScoreAggregationError extends Error {
  constructor(message, statusCode = 500, errorCode = 'DELIVERABLE_SCORE_AGGREGATION_ERROR', details = {}) {
    super(message);
    this.name = 'DeliverableScoreAggregationError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const roundScore = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const validateGroupId = (groupId) => {
  if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
    throw new DeliverableScoreAggregationError(
      'groupId is required',
      400,
      'INVALID_GROUP_ID'
    );
  }
};

const normalizeIncludeDeliverableIds = (includeDeliverableIds) => {
  if (includeDeliverableIds === undefined || includeDeliverableIds === null) {
    return null;
  }

  if (!Array.isArray(includeDeliverableIds) || includeDeliverableIds.length === 0) {
    throw new DeliverableScoreAggregationError(
      'includeDeliverableIds must be a non-empty array when provided',
      400,
      'INVALID_DELIVERABLE_FILTER'
    );
  }

  const normalized = includeDeliverableIds.map((deliverableId) => {
    if (!deliverableId || typeof deliverableId !== 'string' || deliverableId.trim() === '') {
      throw new DeliverableScoreAggregationError(
        'includeDeliverableIds must contain only non-empty strings',
        400,
        'INVALID_DELIVERABLE_FILTER'
      );
    }

    return deliverableId.trim();
  });

  return [...new Set(normalized)];
};

const getReviewerIds = (review) => {
  const scoreReviewers = (review.evaluationScores || [])
    .map((score) => score.ratedBy)
    .filter(Boolean);

  if (scoreReviewers.length > 0) {
    return [...new Set(scoreReviewers)];
  }

  return [...new Set((review.assignedMembers || []).map((member) => member.memberId).filter(Boolean))];
};

const computeWeightedEvaluationScore = (deliverableId, review) => {
  const scores = Array.isArray(review.evaluationScores) ? review.evaluationScores : [];

  if (scores.length === 0) {
    throw new DeliverableScoreAggregationError(
      `Completed review ${review.reviewId} has no usable evaluation scores`,
      409,
      'MISSING_DELIVERABLE_SCORE',
      { deliverableId, reviewId: review.reviewId }
    );
  }

  let weightedTotal = 0;
  let weightTotal = 0;

  for (const scoreRow of scores) {
    const { criterion, score, maxScore, weight } = scoreRow;

    if (!criterion || typeof criterion !== 'string') {
      throw new DeliverableScoreAggregationError(
        `Evaluation score for deliverable ${deliverableId} is missing a criterion`,
        400,
        'INVALID_EVALUATION_SCORE',
        { deliverableId, reviewId: review.reviewId }
      );
    }

    if (!isFiniteNumber(score) || !isFiniteNumber(maxScore) || !isFiniteNumber(weight)) {
      throw new DeliverableScoreAggregationError(
        `Evaluation score for deliverable ${deliverableId} contains non-numeric values`,
        400,
        'INVALID_EVALUATION_SCORE',
        { deliverableId, reviewId: review.reviewId, criterion }
      );
    }

    if (maxScore <= 0 || weight <= 0 || score < 0 || score > maxScore) {
      throw new DeliverableScoreAggregationError(
        `Evaluation score for deliverable ${deliverableId} is outside the allowed range`,
        400,
        'INVALID_EVALUATION_SCORE',
        { deliverableId, reviewId: review.reviewId, criterion, score, maxScore, weight }
      );
    }

    weightedTotal += (score / maxScore) * 100 * weight;
    weightTotal += weight;
  }

  if (weightTotal <= 0) {
    throw new DeliverableScoreAggregationError(
      `Completed review ${review.reviewId} has no positive evaluation weights`,
      409,
      'MISSING_DELIVERABLE_SCORE',
      { deliverableId, reviewId: review.reviewId }
    );
  }

  return {
    score: roundScore(weightedTotal / weightTotal),
    scoreSource: 'evaluationScores',
  };
};

const computeDeliverableScore = (deliverable, review) => {
  if (!review) {
    throw new DeliverableScoreAggregationError(
      `Deliverable ${deliverable.deliverableId} does not have a review record`,
      409,
      'INCOMPLETE_DELIVERABLE_EVALUATION',
      { deliverableId: deliverable.deliverableId }
    );
  }

  if (review.status !== 'completed') {
    throw new DeliverableScoreAggregationError(
      `Deliverable ${deliverable.deliverableId} review is not completed`,
      409,
      'INCOMPLETE_DELIVERABLE_EVALUATION',
      { deliverableId: deliverable.deliverableId, reviewId: review.reviewId, status: review.status }
    );
  }

  if (review.aggregateScore !== null && review.aggregateScore !== undefined) {
    if (!isFiniteNumber(review.aggregateScore) || review.aggregateScore < 0 || review.aggregateScore > 100) {
      throw new DeliverableScoreAggregationError(
        `Aggregate score for deliverable ${deliverable.deliverableId} is outside the allowed range`,
        400,
        'INVALID_AGGREGATE_SCORE',
        { deliverableId: deliverable.deliverableId, reviewId: review.reviewId, aggregateScore: review.aggregateScore }
      );
    }

    return {
      score: roundScore(review.aggregateScore),
      scoreSource: 'aggregateScore',
    };
  }

  return computeWeightedEvaluationScore(deliverable.deliverableId, review);
};

const buildDeliverableQuery = (groupId, includeDeliverableIds) => {
  const query = { groupId };

  if (includeDeliverableIds) {
    query.deliverableId = { $in: includeDeliverableIds };
  }

  return query;
};

const getDeliverableAggregateScoresForGroup = async (groupId, options = {}) => {
  validateGroupId(groupId);
  const normalizedGroupId = groupId.trim();
  const includeDeliverableIds = normalizeIncludeDeliverableIds(options.includeDeliverableIds);

  const deliverables = await Deliverable.find(buildDeliverableQuery(normalizedGroupId, includeDeliverableIds))
    .sort({ submittedAt: 1, deliverableId: 1 })
    .lean();

  if (deliverables.length === 0 && includeDeliverableIds) {
    throw new DeliverableScoreAggregationError(
      'One or more requested deliverables were not found for this group',
      404,
      'REQUESTED_DELIVERABLES_NOT_FOUND',
      { groupId: normalizedGroupId, missingDeliverableIds: includeDeliverableIds }
    );
  }

  if (deliverables.length === 0) {
    throw new DeliverableScoreAggregationError(
      `No deliverables found for group ${normalizedGroupId}`,
      404,
      'DELIVERABLES_NOT_FOUND',
      { groupId: normalizedGroupId, includeDeliverableIds: includeDeliverableIds || [] }
    );
  }

  if (includeDeliverableIds) {
    const foundIds = new Set(deliverables.map((deliverable) => deliverable.deliverableId));
    const missingDeliverableIds = includeDeliverableIds.filter((deliverableId) => !foundIds.has(deliverableId));

    if (missingDeliverableIds.length > 0) {
      throw new DeliverableScoreAggregationError(
        'One or more requested deliverables were not found for this group',
        404,
        'REQUESTED_DELIVERABLES_NOT_FOUND',
        { groupId: normalizedGroupId, missingDeliverableIds }
      );
    }
  }

  const deliverableIds = deliverables.map((deliverable) => deliverable.deliverableId);
  const reviews = await Review.find({
    groupId: normalizedGroupId,
    deliverableId: { $in: deliverableIds },
  }).lean();

  const reviewsByDeliverableId = new Map(
    reviews.map((review) => [review.deliverableId, review])
  );

  const deliverableScoreBreakdown = {};
  const auditTrail = [];
  let scoreTotal = 0;

  for (const deliverable of deliverables) {
    const review = reviewsByDeliverableId.get(deliverable.deliverableId);
    const { score, scoreSource } = computeDeliverableScore(deliverable, review);

    deliverableScoreBreakdown[deliverable.deliverableId] = score;
    scoreTotal += score;

    auditTrail.push({
      deliverableId: deliverable.deliverableId,
      deliverableType: deliverable.deliverableType,
      sprintId: deliverable.sprintId || null,
      reviewId: review.reviewId,
      score,
      scoreSource,
      reviewerIds: getReviewerIds(review),
      submittedAt: deliverable.submittedAt || null,
      evaluatedAt: review.evaluationCompletedAt || review.updatedAt || null,
    });
  }

  return {
    groupId: normalizedGroupId,
    baseGroupScore: roundScore(scoreTotal / deliverables.length),
    deliverableScoreBreakdown,
    auditTrail,
    createdAt: new Date(),
  };
};

module.exports = {
  DeliverableScoreAggregationError,
  getDeliverableAggregateScoresForGroup,
};
