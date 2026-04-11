const Committee = require('../models/Committee');
const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');
const { dispatchCommitteePublishNotification } = require('./notificationService');

/**
 * FIX #6 (Issue #81): Publish Committee Service with Transactional Integrity
 * 
 * DEFICIENCIES (from PR review):
 * 1. [CRITICAL] Missing D2 (Groups) update - No Group.updateMany() anywhere
 * 2. [CRITICAL] Lack of atomicity - No Mongoose transaction (withTransaction)
 * 3. [CRITICAL] Blocking notification - await in response path causes hangs
 * 4. [HIGH] Missing recipients - hardcoded groupMemberIds: null
 * 5. [HIGH] No transactional integrity - Partial failures leave data inconsistent
 * 
 * SOLUTION:
 * Created reusable service that handles Process 4.5 (Publish Committee) with:
 * ✅ MongoDB session for atomic D3 + D2 + audit operations
 * ✅ D2 Groups update (f07 flow) with all assigned group members
 * ✅ Recipient aggregation from advisors + jury + group members
 * ✅ Fire-and-forget notification dispatch (setImmediate, non-blocking)
 * ✅ Comprehensive error handling and audit trail
 * 
 * TECHNICAL PATTERNS:
 * - MongoDB session.withTransaction() wraps all writes (D3, D2, audit)
 * - If any operation fails, entire transaction rolls back
 * - Notification dispatch moved outside transaction with setImmediate
 * - Response returned BEFORE notification starts (non-blocking pattern)
 * 
 * IMPACT:
 * ✅ Data consistency guaranteed even under partial failure
 * ✅ No 30-60 second request hangs from notification retries
 * ✅ Complete D2 referential integrity (groups linked to committee)
 * ✅ All 3 recipient types notified (advisors, jury, group members)
 */

/**
 * Publish a committee and update all associated data atomically.
 * 
 * Process 4.5 (Committee Publishing):
 * 1. Write to D3 (Committee) - Set status to "published"
 * 2. Write to D2 (Groups) - Link groups to committee via committeeId
 * 3. Write to AuditLog - Record all changes
 * 4. Dispatch notifications (fire-and-forget, non-blocking)
 * 
 * @param {object} options
 * @param {string} options.committeeId - Committee to publish
 * @param {string} options.coordinatorId - User performing the action
 * @param {string[]} [options.assignedGroupIds] - Group IDs to link to committee
 * @returns {Promise<object>} { success, committeeId, status, publishedAt, notificationTriggered }
 * @throws {Error} If validation fails or database error (transaction will rollback)
 */
const publishCommitteeWithTransaction = async ({
  committeeId,
  coordinatorId,
  assignedGroupIds = [],
}) => {
  // Get MongoDB session for transaction
  const session = await Committee.startSession();

  try {
    // Begin transaction
    await session.withTransaction(async () => {
      /**
       * STEP 1: Fetch and validate committee (D3)
       * 
       * Checks:
       * - Committee exists
       * - Status is "validated" (prerequisite for publishing)
       * - Not already published (prevent duplicate publish)
       */
      const committee = await Committee.findOne({ committeeId }).session(session);

      if (!committee) {
        const err = new Error(`Committee ${committeeId} not found`);
        err.statusCode = 404;
        throw err;
      }

      if (committee.status === 'published') {
        const err = new Error('Committee is already published');
        err.statusCode = 409;
        throw err;
      }

      if (committee.status !== 'validated') {
        const err = new Error(
          `Committee must be validated before publishing. Current status: ${committee.status}`
        );
        err.statusCode = 400;
        throw err;
      }

      /**
       * STEP 2: Update committee status to published (D3 write, f06 flow)
       * 
       * Sets:
       * - status: "published"
       * - publishedAt: current timestamp
       * - publishedBy: coordinatorId for audit
       */
      const publishedAt = new Date();
      committee.status = 'published';
      committee.publishedAt = publishedAt;
      committee.publishedBy = coordinatorId;
      await committee.save({ session });

      /**
       * FIX #2 (Issue #81): STEP 3: Update all linked groups (D2 write, f07 flow)
       * 
       * DEFICIENCY: PR review identified missing D2 Groups update
       * "The core requirement of the f07 flow is to update the associated groups
       *  in D2 with their new committee assignment data."
       * 
       * SOLUTION:
       * Update all groups in assignedGroupIds to link them to this committee:
       * - Set committeeId to this committee's ID
       * - Set committeePublishedAt to publication timestamp
       * 
       * This establishes bidirectional relationship:
       * - Committee knows its assigned groups
       * - Groups know their assigned committee
       */
      if (assignedGroupIds && assignedGroupIds.length > 0) {
        await Group.updateMany(
          { groupId: { $in: assignedGroupIds } },
          {
            $set: {
              committeeId: committee.committeeId,
              committeePublishedAt: publishedAt,
            },
          },
          { session }
        );
      }

      /**
       * STEP 4: Create audit logs (within transaction for consistency)
       * 
       * Records two events:
       * 1. COMMITTEE_PUBLISHED - Committee status change
       * 2. GROUPS_LINKED - Groups linked to committee (if any)
       */
      await createAuditLog(
        {
          action: 'COMMITTEE_PUBLISHED',
          actorId: coordinatorId,
          targetId: committeeId,
          details: {
            committeeName: committee.committeeName,
            advisorCount: committee.advisorIds?.length || 0,
            juryCount: committee.juryIds?.length || 0,
            linkedGroupCount: assignedGroupIds?.length || 0,
          },
        },
        { session }
      );

      if (assignedGroupIds && assignedGroupIds.length > 0) {
        await createAuditLog(
          {
            action: 'GROUPS_LINKED_TO_COMMITTEE',
            actorId: coordinatorId,
            targetId: committeeId,
            details: {
              committeeName: committee.committeeName,
              linkedGroupIds: assignedGroupIds,
              linkedGroupCount: assignedGroupIds.length,
            },
          },
          { session }
        );
      }

      // Return committee data for response
      return {
        committee,
        publishedAt,
      };
    });

    // Transaction succeeded; end session
    await session.endSession();

    /**
     * STEP 5: Fetch complete committee data for notification (after transaction)
     * 
     * Needed to get advisorIds, juryIds for recipient aggregation
     * Done AFTER transaction commits to ensure fresh data
     */
    const publishedCommittee = await Committee.findOne({ committeeId });
    const publishedAt = publishedCommittee.publishedAt;

    /**
     * FIX #5 (Issue #81): STEP 6: Fetch group members for recipient aggregation
     * 
     * DEFICIENCY: PR review identified hardcoded null groupMemberIds
     * "The acceptance criteria explicitly demand that notifications be sent to
     *  advisors, jury members, and group members."
     * 
     * SOLUTION:
     * Query all assigned groups and extract member IDs:
     * - For each group in assignedGroupIds
     * - Get all members from Group.members array
     * - Add their IDs to recipients for complete notification coverage
     */
    let groupMemberIds = [];
    if (assignedGroupIds && assignedGroupIds.length > 0) {
      const groupsWithMembers = await Group.find(
        { groupId: { $in: assignedGroupIds } },
        'members' // Only fetch members field
      );

      const memberIdSet = new Set();
      groupsWithMembers.forEach((group) => {
        if (group.members && Array.isArray(group.members)) {
          group.members.forEach((member) => {
            memberIdSet.add(member.userId);
          });
        }
      });
      groupMemberIds = Array.from(memberIdSet);
    }

    /**
     * FIX #4 (Issue #81): STEP 7: Dispatch notifications non-blocking (fire-and-forget)
     * 
     * DEFICIENCY: PR review identified blocking notification dispatch
     * "Sending fan-out notifications to potentially hundreds of users synchronously
     *  will cause the request to hang and timeout."
     * 
     * SOLUTION:
     * Use setImmediate to dispatch notifications AFTER response is sent:
     * - HTTP response returned immediately with status 200
     * - Notification dispatch scheduled for next event loop tick
     * - If notification fails, only audit log is affected (non-fatal)
     * - Response already sent, so user doesn't wait for retry backoff (100/200/400ms)
     * 
     * This pattern:
     * ✅ Prevents request hangs (avoids 30-60 second timeouts)
     * ✅ Maintains database consistency (transaction already committed)
     * ✅ Allows notification retries without blocking user
     * ✅ Gracefully handles notification service unavailability
     */
    setImmediate(async () => {
      try {
        const notificationResult = await dispatchCommitteePublishNotification({
          committeeId,
          committeeName: publishedCommittee.committeeName,
          advisorIds: publishedCommittee.advisorIds || [],
          juryIds: publishedCommittee.juryIds || [],
          groupMemberIds, // Now includes all group members (FIX #5)
          coordinatorId,
        });

        // Log notification dispatch outcome (non-fatal if fails)
        await createAuditLog({
          action: 'NOTIFICATION_DISPATCHED',
          actorId: coordinatorId,
          targetId: committeeId,
          details: {
            operation: 'committee_published',
            notificationId: notificationResult.notificationId,
            success: notificationResult.success,
            recipientCount:
              (publishedCommittee.advisorIds?.length || 0) +
              (publishedCommittee.juryIds?.length || 0) +
              groupMemberIds.length,
            advisorCount: publishedCommittee.advisorIds?.length || 0,
            juryCount: publishedCommittee.juryIds?.length || 0,
            groupMemberCount: groupMemberIds.length,
          },
        });

        if (!notificationResult.success) {
          console.error(
            `[WARNING] Committee publish notification failed for ${committeeId}:`,
            notificationResult.error?.message
          );
        }
      } catch (notificationError) {
        console.error(
          `[WARNING] Notification dispatch error for committee ${committeeId}:`,
          notificationError.message
        );
        // Non-fatal; don't throw or propagate
      }
    });

    return {
      success: true,
      committeeId,
      status: 'published',
      publishedAt,
      notificationTriggered: true, // Always true (actual dispatch happens async)
    };
  } catch (err) {
    await session.endSession();

    // Re-throw with appropriate status code
    if (err.statusCode) {
      throw err;
    }

    // Generic database error
    console.error('[ERROR] Publish committee transaction failed:', err);
    throw new Error(`Failed to publish committee: ${err.message}`);
  }
};

module.exports = {
  publishCommitteeWithTransaction,
};
