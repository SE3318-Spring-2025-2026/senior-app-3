'use strict';

const Group = require('../models/Group');
const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');

const PUBLISHED_READ_FORBIDDEN_MESSAGE =
  'Forbidden - only Coordinators may read group published final grades, and Students may read only their own rows';
const SELF_READ_FORBIDDEN_MESSAGE =
  'Forbidden - only Students may read their own published final grades';

class FinalGradeReadError extends Error {
  constructor(message, statusCode = 500, errorCode = 'FINAL_GRADE_READ_ERROR') {
    super(message);
    this.name = 'FinalGradeReadError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const serializeFinalGrade = (grade) => {
  const source = typeof grade?.toObject === 'function' ? grade.toObject() : grade;
  const finalGrade =
    source.overrideApplied && source.overriddenFinalGrade !== null && source.overriddenFinalGrade !== undefined
      ? source.overriddenFinalGrade
      : source.computedFinalGrade;

  return {
    finalGradeId: source.finalGradeId,
    groupId: source.groupId,
    studentId: source.studentId,
    publishCycle: source.publishCycle,
    baseGroupScore: source.baseGroupScore,
    individualRatio: source.individualRatio,
    computedFinalGrade: source.computedFinalGrade,
    finalGrade,
    status: source.status,
    approvedBy: source.approvedBy,
    approvedAt: source.approvedAt,
    approvalComment: source.approvalComment,
    overrideApplied: source.overrideApplied,
    originalFinalGrade: source.originalFinalGrade,
    overriddenFinalGrade: source.overriddenFinalGrade,
    overriddenBy: source.overriddenBy,
    overrideComment: source.overrideComment,
    publishedAt: source.publishedAt,
    publishedBy: source.publishedBy,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
  };
};

const getPublishedGradesForGroup = async (groupId, requester) => {
  if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
    throw new FinalGradeReadError('Invalid group ID', 400, 'INVALID_GROUP_ID');
  }

  if (!requester) {
    throw new FinalGradeReadError(PUBLISHED_READ_FORBIDDEN_MESSAGE, 403, 'FORBIDDEN_PUBLISHED_GRADE_READ');
  }

  const query = {
    groupId,
    status: FINAL_GRADE_STATUS.PUBLISHED
  };

  if (requester.role === 'coordinator') {
    const grades = await FinalGrade.find(query).sort({ studentId: 1, publishedAt: -1 }).lean();
    return grades.map(serializeFinalGrade);
  }

  if (requester.role === 'professor' || requester.role === 'advisor') {
    const group = await Group.findOne({ groupId }).select('advisorId professorId').lean();
    if (!group) {
      throw new FinalGradeReadError('Group not found', 404, 'GROUP_NOT_FOUND');
    }

    const requesterId = requester.userId;
    const isAssigned =
      (requester.role === 'advisor' && group.advisorId === requesterId) ||
      (requester.role === 'professor' && group.professorId === requesterId);

    if (!isAssigned) {
      throw new FinalGradeReadError(PUBLISHED_READ_FORBIDDEN_MESSAGE, 403, 'FORBIDDEN_PUBLISHED_GRADE_READ');
    }

    const grades = await FinalGrade.find(query).sort({ studentId: 1, publishedAt: -1 }).lean();
    return grades.map(serializeFinalGrade);
  }

  if (requester.role === 'student') {
    throw new FinalGradeReadError(
      'Forbidden - Students must use /api/v1/me/final-grades for published final grade reads',
      403,
      'FORBIDDEN_PUBLISHED_GRADE_READ'
    );
  }

  throw new FinalGradeReadError(PUBLISHED_READ_FORBIDDEN_MESSAGE, 403, 'FORBIDDEN_PUBLISHED_GRADE_READ');
};

const getPublishedGradesForStudent = async (requester) => {
  if (!requester || requester.role !== 'student') {
    throw new FinalGradeReadError(SELF_READ_FORBIDDEN_MESSAGE, 403, 'FORBIDDEN_STUDENT_FINAL_GRADES_READ');
  }

  const grades = await FinalGrade.find({
    studentId: requester.userId,
    status: FINAL_GRADE_STATUS.PUBLISHED
  }).sort({ publishedAt: -1, createdAt: -1 }).lean();

  return grades.map(serializeFinalGrade);
};

module.exports = {
  FinalGradeReadError,
  PUBLISHED_READ_FORBIDDEN_MESSAGE,
  SELF_READ_FORBIDDEN_MESSAGE,
  getPublishedGradesForGroup,
  getPublishedGradesForStudent,
  serializeFinalGrade
};
