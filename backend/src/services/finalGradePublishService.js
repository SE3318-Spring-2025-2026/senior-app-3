'use strict';

/**
 * ================================================================================
 * Final Grade Publish Service
 * ================================================================================
 */

const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
const AuditLog = require('../models/AuditLog');

class FinalGradePublishError extends Error {
  constructor(message, statusCode = 500, errorCode = null) {
    super(message);
    this.name = 'FinalGradePublishError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const publishFinalGrades = async (
  groupId,
  publishCycle,
  coordinatorId,
  notificationFlags = { email: true, sms: false, push: false }
) => {
  if (!groupId) {
    throw new FinalGradePublishError('Group ID is required', 400, 'MISSING_GROUP_ID');
  }
  if (!publishCycle) {
    throw new FinalGradePublishError('Publish cycle is required', 400, 'MISSING_PUBLISH_CYCLE');
  }

  // Check if they are already published
  const hasPublished = await FinalGrade.exists({
    groupId,
    publishCycle,
    status: FINAL_GRADE_STATUS.PUBLISHED
  });

  if (hasPublished) {
    throw new FinalGradePublishError('Bu notlar zaten yayınlanmış', 409, 'ALREADY_PUBLISHED');
  }

  // Get approved grades
  const approvedGrades = await FinalGrade.find({
    groupId,
    publishCycle,
    status: FINAL_GRADE_STATUS.APPROVED
  });

  if (!approvedGrades || approvedGrades.length === 0) {
    throw new FinalGradePublishError(
      'No approved grades found for publication. An Approval Snapshot is required.',
      422,
      'NO_APPROVED_GRADES'
    );
  }

  // Transaction
  const session = await FinalGrade.startSession();
  session.startTransaction();

  try {
    const auditLogs = [];
    let publishedCount = 0;

    for (const grade of approvedGrades) {
      grade.status = FINAL_GRADE_STATUS.PUBLISHED;
      grade.publishedAt = new Date();
      grade.publishedBy = coordinatorId;
      
      await grade.save({ session });
      publishedCount++;

      auditLogs.push({
        action: 'FINAL_GRADE_PUBLISHED',
        actorId: coordinatorId,
        targetId: grade.studentId,
        groupId,
        payload: {
          publishCycle,
          publishedAt: grade.publishedAt,
          effectiveGrade: grade.getEffectiveFinalGrade(),
          notificationFlags
        }
      });
    }

    await AuditLog.insertMany(auditLogs, { session });
    await session.commitTransaction();

    // Async notification logic would go here
    setImmediate(() => {
      console.log(`Notifications triggered with flags:`, notificationFlags);
    });

    return {
      success: true,
      groupId,
      publishCycle,
      publishedCount,
      publishedAt: new Date(),
      publishedBy: coordinatorId,
      notificationStatus: notificationFlags
    };
  } catch (error) {
    await session.abortTransaction();
    throw new FinalGradePublishError(`Publishing failed: ${error.message}`, 500, 'PUBLISH_FAILED');
  } finally {
    session.endSession();
  }
};

module.exports = {
  publishFinalGrades,
  FinalGradePublishError
};
