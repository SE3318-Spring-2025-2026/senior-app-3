'use strict';

/**
 * ================================================================================
 * Final Grade Publish Service
 * ================================================================================
 */

const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
const AuditLog = require('../models/AuditLog');
const notificationService = require('./notificationService');

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
  requestedPublishCycle,
  coordinatorId,
  notificationFlags = { email: true, sms: false, push: false }
) => {
  if (!groupId) {
    throw new FinalGradePublishError('Group ID is required', 400, 'MISSING_GROUP_ID');
  }
  if (!requestedPublishCycle) {
    throw new FinalGradePublishError('Publish cycle is required', 400, 'MISSING_PUBLISH_CYCLE');
  }

  const hasPublished = await FinalGrade.exists({
    groupId,
    publishCycle: requestedPublishCycle,
    status: FINAL_GRADE_STATUS.PUBLISHED
  });

  if (hasPublished) {
    throw new FinalGradePublishError('Bu notlar zaten yayınlanmış', 409, 'ALREADY_PUBLISHED');
  }

  const approvedSnapshot = await FinalGrade.find({
    groupId,
    status: FINAL_GRADE_STATUS.APPROVED
  });

  if (!approvedSnapshot || approvedSnapshot.length === 0) {
    throw new FinalGradePublishError(
      'No approved grades found for publication. An Approval Snapshot is required.',
      422,
      'NO_APPROVED_GRADES'
    );
  }

  const approvedCycleSet = new Set(approvedSnapshot.map((grade) => grade.publishCycle).filter(Boolean));
  if (approvedCycleSet.size !== 1 || !approvedCycleSet.has(requestedPublishCycle)) {
    throw new FinalGradePublishError(
      'Publish cycle does not match the approved snapshot cycle',
      409,
      'INCONSISTENT_CYCLE'
    );
  }

  const publishCycle = approvedSnapshot[0].publishCycle;

  // Transaction
  const session = await FinalGrade.startSession();
  session.startTransaction();

  try {
    const publishedAt = new Date();
    const updateResult = await FinalGrade.updateMany(
      {
        groupId,
        publishCycle,
        status: FINAL_GRADE_STATUS.APPROVED
      },
      {
        $set: {
          status: FINAL_GRADE_STATUS.PUBLISHED,
          publishedAt,
          publishedBy: coordinatorId
        }
      },
      { session }
    );

    const publishedCount = updateResult.modifiedCount || 0;
    if (publishedCount === 0) {
      const publishedProbe = FinalGrade.exists({
        groupId,
        publishCycle,
        status: FINAL_GRADE_STATUS.PUBLISHED
      });
      const alreadyPublished =
        publishedProbe && typeof publishedProbe.session === 'function'
          ? await publishedProbe.session(session)
          : await publishedProbe;

      if (alreadyPublished) {
        throw new FinalGradePublishError(
          'Bu notlar başka bir işlem tarafından zaten yayınlanmış.',
          409,
          'ALREADY_PUBLISHED'
        );
      }

      throw new FinalGradePublishError('Yayınlanacak onaylanmış not bulunamadı.', 422, 'NO_APPROVED_GRADES');
    }

    await AuditLog.create(
      [
        {
          action: 'FINAL_GRADE_PUBLISHED',
          actorId: coordinatorId,
          targetId: groupId,
          groupId,
          payload: {
            publishCycle,
            publishedAt,
            affectedCount: publishedCount,
            notificationFlags
          }
        }
      ],
      { session }
    );
    await session.commitTransaction();

    // Fire-and-forget dispatch to keep publish response fast.
    setImmediate(() => {
      notificationService
        .dispatchBulkFinalGradeNotifications(groupId, publishCycle, notificationFlags)
        .catch((notificationError) => {
          console.error('[Publish Final Grades] Notification dispatch failed:', notificationError);
        });
    });

    return {
      success: true,
      groupId,
      publishCycle,
      publishedCount,
      publishedAt,
      publishedBy: coordinatorId,
      notificationStatus: notificationFlags
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof FinalGradePublishError) {
      throw error;
    }
    throw new FinalGradePublishError(`Publishing failed: ${error.message}`, 500, 'PUBLISH_FAILED');
  } finally {
    session.endSession();
  }
};

module.exports = {
  publishFinalGrades,
  FinalGradePublishError
};
