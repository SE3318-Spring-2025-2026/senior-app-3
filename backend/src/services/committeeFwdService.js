const { createAuditLog } = require('./auditService');

/**
 * Forward advisor assignments to process 4.4 (Committee Setup Validation)
 * 
 * Phase 1 Implementation: Log the forward action and create audit entry
 * Phase 2 Implementation (Issue #74): Trigger actual validation logic
 *
 * @param {string} committeeId - Committee ID
 * @param {string[]} advisorIds - Assigned advisor IDs
 * @param {string} coordinatorId - Coordinator who made the assignment
 * @param {object} [session] - Mongoose session for transactional writes
 */
const forwardAssignmentsTo4_4 = async (committeeId, advisorIds, coordinatorId, session = null) => {
  try {
    // Phase 1: Create audit log entry for the forward action
    const forwardLog = await createAuditLog(
      {
        action: 'COMMITTEE_ADVISORS_FORWARDED_TO_VALIDATION',
        actorId: coordinatorId,
        targetId: committeeId,
        payload: {
          committeeId,
          advisorIds,
          process: '4.2 → 4.4',
          description: 'Advisor assignments forwarded to Committee Setup Validation (Process 4.4)',
        },
      },
      session
    );

    console.log(
      `[Process Forward 4.2→4.4] Committee ${committeeId} with ${advisorIds.length} advisor(s) forwarded to validation`
    );

    return {
      success: true,
      forwardedAt: forwardLog.createdAt,
      logId: forwardLog._id,
    };
  } catch (error) {
    console.error(`[Process Forward Error] Failed to forward ${committeeId} to 4.4:`, error.message);
    throw error;
  }
};

module.exports = {
  forwardAssignmentsTo4_4,
};
