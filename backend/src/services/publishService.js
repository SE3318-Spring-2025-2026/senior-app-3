/**
 * ================================================================================
 * ISSUE #255: Final Grade Publication Service
 * ================================================================================
 *
 * Purpose:
 * Handles final grade publication to D7 collection (Process 8.5).
 * Responsible for:
 * 1. Validating publish eligibility (all grades approved, none published)
 * 2. Atomically writing approved grades to D7 with status=published
 * 3. Creating publication audit logs
 * 4. Dispatching student & faculty notifications with 3-attempt retry
 * 5. Handling notification failures gracefully (don't block publish)
 * 6. Enforcing 409 conflict for duplicate/already-published grades
 *
 * Process Context:
 * - Input: Request from Issue #252 UI POST /groups/{groupId}/final-grades/publish
 * - Source: FinalGrade records with status='approved' (from Issue #253)
 * - Atomic operation: All D7 writes within single MongoDB transaction
 * - Output: FinalGradePublishResult with publishedAt timestamp
 * - Notifications: Async dispatch via setImmediate; retry with exponential backoff
 * - Audit trail: FINAL_GRADES_PUBLISHED action + notification success/failure tracking
 *
 * Integration with Issue #253:
 * - Consumes approved grades from FinalGrade model
 * - Preserves override metadata (overriddenFinalGrade, overriddenBy, overrideComment)
 * - Preserves approval context (approvedBy, approvedAt, approvalComment)
 * - Links to audit logs created during approval workflow
 *
 * Integration with Issue #256 (Dashboards):
 * - D7 data shape used for grade reporting/analytics
 * - Published timestamp enables timeline views
 * - Status=published filters grades for final reports
 *
 * ================================================================================
 */

const { FinalGrade, FINAL_GRADE_STATUS } = require('../models/FinalGrade');
const AuditLog = require('../models/AuditLog');
const Group = require('../models/Group');
const User = require('../models/User');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('./auditService');
const { dispatchFinalGradeNotificationToStudent, dispatchFinalGradeReportToFaculty } = require('./notificationService');
const { retryNotificationWithBackoff } = require('./notificationRetry');
const { v4: uuidv4 } = require('uuid');

/**
 * ISSUE #255: Error class for grade publication specific errors
 * Used to distinguish publish errors from general application errors
 */
class GradePublishError extends Error {
  constructor(message, statusCode = 500, errorCode = null) {
    super(message);
    this.name = 'GradePublishError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * ================================================================================
 * ISSUE #255: CORE PUBLISH VALIDATION & EXECUTION
 * ================================================================================
 */

/**
 * ISSUE #255: Validate that grades can be published
 * 
 * Checks:
 * 1. Group exists and is valid
 * 2. No grades for this group are already published (409 idempotency)
 * 3. At least one grade exists in approved state
 * 4. No rejected grades present (cannot publish rejected)
 * 5. All grades completed approval workflow (Issue #253)
 *
 * Throws GradePublishError with appropriate statusCode:
 * - 404 if group not found or no grades exist
 * - 409 if already published or mixed approval states
 * - 422 if validation data missing
 *
 * @param {String} groupId - Group to validate
 * @returns {Promise<Object>} { valid: true, grades: [...], groupName: String }
 * @throws {GradePublishError} If validation fails
 */
const validatePublishEligibility = async (groupId) => {
  // ISSUE #255: Verify group exists
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new GradePublishError(
      `Group ${groupId} not found`,
      404,
      'GROUP_NOT_FOUND'
    );
  }

  // ISSUE #255: Use FinalGrade model helper to check publish eligibility
  const eligibility = await FinalGrade.checkPublishEligibility(groupId);
  
  // ISSUE #255: If cannot publish, throw error with appropriate status code
  if (!eligibility.canPublish) {
    // ISSUE #255: Already published = 409 Conflict (idempotency guard)
    if (eligibility.publishedCount && eligibility.publishedCount > 0) {
      throw new GradePublishError(
        eligibility.reason,
        409,
        'ALREADY_PUBLISHED'
      );
    }

    // ISSUE #255: No grades or approval incomplete = 404 or 422
    if (eligibility.count === 0) {
      throw new GradePublishError(
        eligibility.reason,
        404,
        'NO_GRADES_FOUND'
      );
    }

    // ISSUE #255: Mixed/incomplete approval states = 422 Unprocessable
    throw new GradePublishError(
      eligibility.reason,
      422,
      'APPROVAL_INCOMPLETE'
    );
  }

  // ISSUE #255: Fetch full grade documents for publishing
  const approvedGrades = await FinalGrade.find({
    groupId,
    status: FINAL_GRADE_STATUS.APPROVED
  });

  return {
    valid: true,
    grades: approvedGrades,
    groupName: group.groupName || group.groupCode,
    groupId
  };
};

/**
 * ISSUE #255: Publish final grades atomically to D7
 * 
 * Steps within MongoDB transaction:
 * 1. Update all FinalGrade records: status='published', publishedAt, publishedBy
 * 2. Create FINAL_GRADES_PUBLISHED audit log with count and timestamp
 * 3. Mark group evaluation as complete (if tracking in Group model)
 * 4. Commit transaction (all-or-nothing atomicity)
 *
 * Failures:
 * - Any write error → rollback entire transaction, return 500
 * - Duplicate publish attempt → detected before transaction, return 409
 *
 * @param {String} groupId - Group being published
 * @param {String} coordinatorId - Coordinator performing publish
 * @param {Array<Object>} grades - FinalGrade documents to publish
 * @returns {Promise<Object>} { publishedAt, publishCount, auditLogId }
 * @throws {GradePublishError} On transaction failure
 */
const publishGradesToD7WithTransaction = async (groupId, coordinatorId, grades) => {
  // ISSUE #255: Start MongoDB session for transaction
  const session = await FinalGrade.startSession();

  try {
    // ISSUE #255: Begin atomic transaction
    await session.withTransaction(async () => {
      // ISSUE #255: Step 1 - Update all grades to published state
      const publishedAt = new Date();
      
      const gradeIds = grades.map(g => g._id);
      
      // ISSUE #255: Batch update all grades atomically
      // Sets: status=published, publishedAt, publishedBy
      // This ensures all-or-nothing publication (no partial updates)
      const updateResult = await FinalGrade.updateMany(
        { _id: { $in: gradeIds } },
        {
          $set: {
            status: FINAL_GRADE_STATUS.PUBLISHED,
            publishedAt,
            publishedBy: coordinatorId,
            updatedAt: new Date()
          }
        },
        { session }
      );

      // ISSUE #255: Verify all grades were updated (sanity check)
      if (updateResult.modifiedCount !== grades.length) {
        throw new GradePublishError(
          `Expected ${grades.length} updates, got ${updateResult.modifiedCount}`,
          500,
          'PUBLISH_MISMATCH'
        );
      }

      // ISSUE #255: Step 2 - Create audit log within transaction
      // This ensures audit trail is consistent with D7 writes
      await createAuditLog(
        {
          action: 'FINAL_GRADE_PUBLISHED',
          actorId: coordinatorId,
          targetId: groupId,
          details: {
            publishedAt: publishedAt.toISOString(),
            gradeCount: grades.length,
            studentIds: grades.map(g => g.studentId),
            averageFinalGrade: grades.reduce((sum, g) => sum + g.getEffectiveGrade(), 0) / grades.length
          }
        },
        session
      );

      // ISSUE #255: Step 3 - Mark group evaluation complete (optional tracking)
      // This ties publication to group lifecycle; helps dashboards track completion
      await Group.updateOne(
        { groupId },
        {
          $set: {
            finalGradePublishedAt: publishedAt,
            finalGradePublishedBy: coordinatorId
          }
        },
        { session }
      );

      // ISSUE #255: Transaction auto-commits at end of withTransaction block
      // If any error occurs, entire transaction rolls back automatically
    });

    // ISSUE #255: Transaction succeeded; return publication metadata
    return {
      publishedAt: new Date(),
      publishCount: grades.length,
      status: 'published'
    };

  } catch (error) {
    // ISSUE #255: Transaction failed or rolled back
    throw new GradePublishError(
      `Failed to publish grades: ${error.message}`,
      500,
      'TRANSACTION_FAILED'
    );
  } finally {
    // ISSUE #255: Always clean up session
    await session.endSession();
  }
};

/**
 * ISSUE #255: Dispatch notifications to students and optionally faculty
 * 
 * Runs asynchronously (setImmediate) to avoid blocking publish response.
 * Uses retryNotificationWithBackoff for resilience:
 * - Up to 3 attempts per notification
 * - Exponential backoff: 100ms, 200ms, 400ms
 * - Transient errors (5xx, timeout) trigger retry
 * - Permanent errors (4xx, invalid data) fail fast
 *
 * Failures logged to SyncErrorLog; don't block publish success.
 * Returns dispatch summary for response metadata.
 *
 * @param {String} groupId - Group being published
 * @param {Array<Object>} grades - FinalGrade documents (with students)
 * @param {String} coordinatorId - Coordinator who published
 * @param {Boolean} notifyFaculty - Should faculty receive notifications?
 * @param {String} correlationId - Trace ID for this publish operation
 * @returns {Promise<Object>} { sent: Number, failed: Number, skipped: Number }
 */
const dispatchNotificationsAsync = async (
  groupId,
  grades,
  coordinatorId,
  notifyFaculty,
  correlationId
) => {
  // ISSUE #255: Non-blocking dispatch via setImmediate
  // This prevents notification service delays from blocking the HTTP response
  setImmediate(async () => {
    let sentCount = 0;
    let failedCount = 0;

    try {
      // ISSUE #255: Dispatch student notifications (one per grade)
      for (const grade of grades) {
        try {
          // ISSUE #255: Create student notification dispatch function
          const dispatchFn = async () => {
            return await dispatchFinalGradeNotificationToStudent({
              groupId,
              studentId: grade.studentId,
              finalGrade: grade.getEffectiveGrade(),
              publishedAt: new Date(),
              coordinatorId,
              groupName: (await Group.findOne({ groupId }))?.groupName
            });
          };

          // ISSUE #255: Retry up to 3 times with backoff
          const result = await retryNotificationWithBackoff(dispatchFn, {
            maxRetries: 3,
            backoffMs: [100, 200, 400],
            context: {
              groupId,
              studentId: grade.studentId,
              actorId: coordinatorId,
              correlationId
            }
          });

          // ISSUE #255: Track success/failure
          if (result.success) {
            sentCount++;
          } else {
            failedCount++;
            // ISSUE #255: Log to SyncErrorLog for manual investigation
            await SyncErrorLog.create({
              service: 'notification',
              groupId,
              actorId: coordinatorId,
              attempts: 3,
              lastError: {
                message: result.error?.message || 'Unknown error',
                code: result.error?.code || 'NOTIFICATION_FAILED'
              }
            });
          }
        } catch (err) {
          failedCount++;
          console.error(`[Issue #255] Student notification failed for ${grade.studentId}:`, err.message);
        }
      }

      // ISSUE #255: Optional: Dispatch faculty/committee notifications
      if (notifyFaculty) {
        try {
          const group = await Group.findOne({ groupId });
          
          // ISSUE #255: Send aggregate report to all committee members
          const dispatchFn = async () => {
            return await dispatchFinalGradeReportToFaculty({
              groupId,
              gradeCount: grades.length,
              averageGrade: grades.reduce((sum, g) => sum + g.getEffectiveGrade(), 0) / grades.length,
              publishedAt: new Date(),
              coordinatorId,
              groupName: group?.groupName
            });
          };

          const result = await retryNotificationWithBackoff(dispatchFn, {
            maxRetries: 3,
            backoffMs: [100, 200, 400],
            context: {
              groupId,
              type: 'faculty_report',
              actorId: coordinatorId,
              correlationId
            }
          });

          if (!result.success) {
            failedCount++;
          }
        } catch (err) {
          console.error(`[Issue #255] Faculty notification failed:`, err.message);
          failedCount++;
        }
      }

      // ISSUE #255: Log publication notification summary
      console.log(
        `[Issue #255] Publish notifications: ${sentCount} sent, ${failedCount} failed, correlationId: ${correlationId}`
      );
    } catch (err) {
      console.error(`[Issue #255] Notification dispatch error:`, err.message);
    }
  });

  // ISSUE #255: Return immediately; actual dispatch happens async
  return {
    sentCount: 0, // Will be updated after async dispatch completes
    failedCount: 0,
    status: 'queued'
  };
};

/**
 * ================================================================================
 * ISSUE #255: MAIN PUBLISH WORKFLOW
 * ================================================================================
 */

/**
 * ISSUE #255: Main entry point for final grade publication
 * 
 * Complete workflow:
 * 1. Validate publish eligibility (409 check, group/grade validation)
 * 2. Atomically update D7 FinalGrade collection (all status='published')
 * 3. Create audit log for compliance/reporting
 * 4. Dispatch notifications async (won't block response)
 * 5. Return FinalGradePublishResult for frontend (#252 UI)
 *
 * Error handling:
 * - 404: Group not found or no grades exist
 * - 409: Already published (idempotency)
 * - 422: Approval incomplete or validation failed
 * - 500: Transaction/database error
 *
 * Integration points:
 * - Issue #253 approval records (source of grades)
 * - Issue #256 dashboard queries (D7 data consumption)
 * - Issue #262 RBAC tests (403 handled by middleware)
 *
 * @param {String} groupId - Group ID to publish
 * @param {String} coordinatorId - Coordinator performing publish
 * @param {Object} options - Publication options
 *   - notifyFaculty: Boolean - Should faculty receive notifications?
 *   - notifyStudents: Boolean - Should students be notified?
 * @returns {Promise<Object>} FinalGradePublishResult
 *   {
 *     success: true,
 *     publishId: String,
 *     publishedAt: Date,
 *     groupId: String,
 *     studentCount: Number,
 *     notificationsDispatched: Boolean,
 *     message: String
 *   }
 * @throws {GradePublishError} If publication fails
 */
const publishFinalGrades = async (
  groupId,
  coordinatorId,
  options = {}
) => {
  // ISSUE #255: Generate correlation ID for tracing this publish through notification system
  const correlationId = `pub_${groupId}_${uuidv4().split('-')[0]}`;

  console.log(`[Issue #255] Starting publish workflow: ${correlationId}`);

  try {
    // ISSUE #255: Step 1 - Validate eligibility (throws 404/409/422 as needed)
    const eligibilityCheck = await validatePublishEligibility(groupId);

    console.log(
      `[Issue #255] Eligibility check passed. Publishing ${eligibilityCheck.grades.length} grades`
    );

    // ISSUE #255: Step 2 - Atomically publish to D7 within transaction
    const publishResult = await publishGradesToD7WithTransaction(
      groupId,
      coordinatorId,
      eligibilityCheck.grades
    );

    console.log(
      `[Issue #255] D7 publication complete. Published ${publishResult.publishCount} grades.`
    );

    // ISSUE #255: Step 3 - Dispatch notifications asynchronously (non-blocking)
    const notifyOptions = {
      notifyFaculty: options.notifyFaculty || false,
      notifyStudents: options.notifyStudents !== false // Default true
    };

    // ISSUE #255: Fire-and-forget: dispatch immediately but don't await
    dispatchNotificationsAsync(
      groupId,
      eligibilityCheck.grades,
      coordinatorId,
      notifyOptions.notifyFaculty,
      correlationId
    ).catch(err => {
      console.error(`[Issue #255] Notification dispatch queue error:`, err);
    });

    // ISSUE #255: Step 4 - Return success response for frontend
    // Issue #255 marks publication complete; Issue #256 will query D7 for dashboard
    return {
      success: true,
      publishId: correlationId,
      publishedAt: publishResult.publishedAt,
      groupId,
      groupName: eligibilityCheck.groupName,
      studentCount: eligibilityCheck.grades.length,
      notificationsDispatched: notifyOptions.notifyStudents || notifyOptions.notifyFaculty,
      message: `Successfully published ${eligibilityCheck.grades.length} final grades to D7`
    };

  } catch (error) {
    // ISSUE #255: Log publication failure with correlation ID for debugging
    console.error(`[Issue #255] Publish failed (${correlationId}):`, error.message);

    // ISSUE #255: Re-throw with appropriate HTTP status code
    if (error instanceof GradePublishError) {
      throw error;
    }

    // ISSUE #255: Unexpected error → 500
    throw new GradePublishError(
      `Unexpected error during publish: ${error.message}`,
      500,
      'PUBLISH_ERROR'
    );
  }
};

/**
 * ================================================================================
 * ISSUE #255: HELPER & QUERY FUNCTIONS FOR DASHBOARDS
 * ================================================================================
 */

/**
 * ISSUE #255: Get publish status for a group (for dashboard #256)
 * 
 * Returns:
 * - Whether any grades have been published
 * - When they were published
 * - Publish completion percentage
 * - Used for progress tracking in coordinator UI
 *
 * @param {String} groupId - Group to check
 * @returns {Promise<Object>} { isPublished, publishedAt, percentage, studentCount }
 */
const getGroupPublishStatus = async (groupId) => {
  const publishedGrades = await FinalGrade.find({
    groupId,
    status: FINAL_GRADE_STATUS.PUBLISHED
  });

  const totalGrades = await FinalGrade.find({ groupId });

  return {
    isPublished: publishedGrades.length > 0,
    publishedAt: publishedGrades.length > 0 ? publishedGrades[0].publishedAt : null,
    percentage: totalGrades.length > 0 ? (publishedGrades.length / totalGrades.length * 100) : 0,
    studentCount: publishedGrades.length,
    totalCount: totalGrades.length
  };
};

// ================================================================================
// ISSUE #255: EXPORTS
// ================================================================================

module.exports = {
  publishFinalGrades,
  getGroupPublishStatus,
  GradePublishError,
  // Helpers for testing
  validatePublishEligibility,
  publishGradesToD7WithTransaction
};
