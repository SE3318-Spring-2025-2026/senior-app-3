const Group = require('../models/Group');
const AdvisorAssignment = require('../models/AdvisorAssignment');
const User = require('../models/User');
const SyncErrorLog = require('../models/SyncErrorLog');
const { createAuditLog } = require('./auditService');
const { v4: uuidv4 } = require('uuid');

/**
 * Custom error class for advisor service errors
 */
class AdvisorServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'AdvisorServiceError';
  }
}

/**
 * Approve an advisor request and assign the professor to the group.
 * Updates D2 (Group model) with advisorId and advisorStatus: assigned.
 * Creates AdvisorAssignment record for historical tracking.
 * Called by Process 3.5 after approval signal from Process 3.4.
 * 
 * Issue #64 Fix #2: CRITICAL - Uses Mongoose transaction to ensure Group and 
 * AdvisorAssignment are both created/updated atomically, preventing orphaned states.
 *
 * @param {string} groupId - Target group ID
 * @param {string} requestId - Advisor request ID to approve
 * @param {string} professorId - Professor approving (must match request)
 * @param {string} approverId - Professor user ID (requester of approval)
 * @param {object} options - { ipAddress, userAgent }
 * @returns {object} { groupId, professorId, status, updatedAt }
 */
const approveAdvisorRequest = async (groupId, requestId, professorId, approverId, options = {}) => {
  // Issue #64 Fix #2 CRITICAL: Implement Mongoose transaction for data consistency
  // PROBLEM: Previous implementation executed Group.save() and AdvisorAssignment.create() sequentially
  //          If Group saves successfully but AdvisorAssignment.create() fails (network error, 
  //          validation error, timeout), the database is left in an ORPHANED/INCONSISTENT state:
  //          - Group record has advisorId set (group thinks it has advisor)
  //          - But no corresponding AdvisorAssignment record exists (assignment tracking lost)
  //          This violates data integrity and breaks audit trail
  //
  // SOLUTION: Wrap both operations in a Mongoose session transaction
  // - All queries and writes use the same session
  // - If any operation fails, ALL changes are rolled back atomically
  // - If all succeed, changes are committed atomically (all-or-nothing guarantee)
  // This is ACID compliance at the document level using MongoDB transactions
  
  const session = await Group.startSession();
  session.startTransaction();
  
  try {
    // Fetch group within transaction session (ensures read consistency within transaction context)
    const group = await Group.findOne({ groupId }).session(session);
    if (!group) {
      // If group not found, abort transaction to release locks/resources immediately
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    if (!group.advisorRequest) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'NO_ADVISOR_REQUEST', 'No advisor request found for this group');
    }

    if (group.advisorRequest.requestId !== requestId) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'REQUEST_ID_MISMATCH', 'Request ID does not match group advisory request');
    }

    if (group.advisorRequest.status !== 'pending') {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'REQUEST_ALREADY_PROCESSED', `Request has already been ${group.advisorRequest.status}`);
    }

    // Validate professor matches
    if (group.advisorRequest.professorId !== professorId) {
      await session.abortTransaction();
      throw new AdvisorServiceError(403, 'PROFESSOR_MISMATCH', 'Professor ID does not match the request');
    }

    // Check professor exists and is active (also within transaction for consistency)
    const professor = await User.findOne({ userId: professorId }).session(session);
    if (!professor || professor?.role !== 'professor' || professor?.accountStatus !== 'active') {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'PROFESSOR_INVALID', 'Professor is not active or does not exist');
    }

    // Update group with assigned advisor (within transaction session)
    const now = new Date();
    group.advisorId = professorId;
    group.advisorStatus = 'assigned';
    group.advisorUpdatedAt = now;
    group.advisorRequest.status = 'approved';
    group.advisorRequest.approvedAt = now;
    // Pass session to save operation so it's part of the transaction
    await group.save({ session });

    // Issue #64 Fix #2: Create AdvisorAssignment WITHIN same transaction (critical for atomicity)
    // If this create() fails, the entire transaction rolls back and group.save() is undone
    // This maintains the invariant: every Group with advisorId has a corresponding AdvisorAssignment
    const assignment = await AdvisorAssignment.create(
      [
        {
          assignmentId: `asn_${uuidv4().split('-')[0]}`,
          groupId,
          professorId,
          status: 'assigned',
          updatedAt: now,
          updatedBy: approverId,
          reason: 'Advisor approved the assignment request',
        },
      ],
      { session }  // Pass session so create is part of the transaction
    );

    // Create audit log (non-transactional, best-effort)
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: approverId,
        groupId,
        payload: {
          previous_status: null,
          new_status: 'assigned',
          reason: 'Advisor approved request and was assigned to group',
          requestId,
          assignmentId: assignment[0].assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    // Issue #64 Fix #2: Commit transaction (persist all changes atomically)
    // This confirms all operations succeeded and changes should be written to disk
    await session.commitTransaction();

    return {
      groupId,
      professorId,
      status: 'assigned',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    // Issue #64 Fix #2: Rollback on any error (undo all transactional changes)
    // This ensures no partial/orphaned state if any operation in the transaction fails
    await session.abortTransaction();
    
    if (error instanceof AdvisorServiceError) {
      throw error;
    }
    console.error('advisorService.approveAdvisorRequest error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while approving the advisor request');
  } finally {
    // Issue #64 Fix #2: Always end the session (releases locks, cleans up resources)
    // This ensures MongoDB/Mongoose doesn't hold locks even if transaction committed/aborted
    session.endSession();
  }
};

/**
 * Release an assigned advisor from a group.
 * Clears advisorId and sets advisorStatus: released.
 * Creates AdvisorAssignment record with released status.
 * Called by Process 3.5 after release signal (DELETE /groups/:groupId/advisor).
 * 
 * Issue #64 Fix #2: Uses Mongoose transaction to ensure data integrity.
 *
 * @param {string} groupId - Target group ID
 * @param {string} releasedBy - User ID initiating release
 * @param {string} reason - Reason for release (optional)
 * @param {object} options - { ipAddress, userAgent }
 * @returns {object} { groupId, professorId, status, updatedAt }
 */
const releaseAdvisor = async (groupId, releasedBy, reason = null, options = {}) => {
  // Issue #64 Fix #2: Implement transaction for release operation (same rationale as approve)
  // Both Group.save() (clear advisorId) and AdvisorAssignment.create() (track release) must succeed together
  
  const session = await Group.startSession();
  session.startTransaction();
  
  try {
    // Fetch group within transaction
    const group = await Group.findOne({ groupId }).session(session);
    if (!group) {
      await session.abortTransaction();
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    // Validation: Only release if group currently HAS an assigned advisor
    if (!group.advisorId) {
      await session.abortTransaction();
      throw new AdvisorServiceError(409, 'NO_ADVISOR_ASSIGNED', 'Group does not have an assigned advisor');
    }

    const previousAdvisorId = group.advisorId;
    const now = new Date();

    // Update group to release advisor (set advisorId to null and status to released)
    group.advisorId = null;
    group.advisorStatus = 'released';
    group.advisorUpdatedAt = now;
    await group.save({ session });

    // Issue #64 Fix #2: Create AdvisorAssignment record WITHIN transaction
    // Records the release action for audit trail and historical tracking
    const assignment = await AdvisorAssignment.create(
      [
        {
          assignmentId: `asn_${uuidv4().split('-')[0]}`,
          groupId,
          professorId: previousAdvisorId,
          status: 'released',
          updatedAt: now,
          updatedBy: releasedBy,
          reason: reason || 'Advisor released from group',
        },
      ],
      { session }
    );

    // Create audit log for operational visibility
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: releasedBy,
        groupId,
        payload: {
          previous_status: 'assigned',
          new_status: 'released',
          reason: reason || 'Advisor released',
          previousAdvisorId,
          assignmentId: assignment[0].assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    // Commit transaction (persist all changes atomically)
    await session.commitTransaction();

    return {
      groupId,
      professorId: null,
      status: 'released',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    // Rollback on any error
    await session.abortTransaction();
    
    if (error instanceof AdvisorServiceError) {
      throw error;
    }
    console.error('advisorService.releaseAdvisor error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while releasing the advisor');
  } finally {
    session.endSession();
  }
};

/**
 * Transfer a group from its current advisor to a new professor.
 * Updates advisorId with new professor and sets advisorStatus: transferred.
 * Creates AdvisorAssignment record with transferred status.
 * Called by Process 3.5 after transfer signal from Process 3.6 (coordinator).
 * 
 * Issue #64 Fix #4: MEDIUM - Validates that group currently has an assigned advisor
 * before allowing transfer (cannot transfer if no advisor exists).
 *
 * @param {string} groupId - Target group ID
 * @param {string} newProfessorId - New professor to assign
 * @param {string} transferredBy - Coordinator user ID initiating transfer
 * @param {string} reason - Reason for transfer (optional)
 * @param {object} options - { ipAddress, userAgent }
 * @returns {object} { groupId, professorId, status, updatedAt }
 */
const transferAdvisor = async (groupId, newProfessorId, transferredBy, reason = null, options = {}) => {
  try {
    // Fetch group
    const group = await Group.findOne({ groupId });
    if (!group) {
      throw new AdvisorServiceError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    // Issue #64 Fix #4 MEDIUM: Guard clause - cannot transfer if no advisor currently assigned
    // PROBLEM: Previous code allowed transferring a group that has NO assigned advisor
    //          This violates business rule: "transfer" implies reassigning from one advisor to another
    //          You cannot "transfer" something that doesn't exist
    // SOLUTION: Check group.advisorId exists before proceeding with transfer logic
    // If group has no current advisor, reject immediately with clear error message
    // This guides the user to use the advisee request flow instead (normal approval flow)
    if (!group.advisorId) {
      throw new AdvisorServiceError(
        409,
        'NO_ADVISOR_TO_TRANSFER',
        'Cannot transfer: group does not have an assigned advisor. Use advisee request flow instead.'
      );
    }

    const previousAdvisorId = group.advisorId;

    // Validate new professor exists and is active
    const professor = await User.findOne({ userId: newProfessorId });
    // eslint-disable-next-line no-unsafe-optional-chaining
    if (!professor || professor?.role !== 'professor' || professor?.accountStatus !== 'active') {
      throw new AdvisorServiceError(409, 'PROFESSOR_INVALID', 'New professor is not active or does not exist');
    }

    // Check for conflict: new professor not already assigned to another group
    const existingAssignment = await Group.findOne({
      advisorId: newProfessorId,
      groupId: { $ne: groupId },
      status: 'active',
    });

    if (existingAssignment) {
      throw new AdvisorServiceError(409, 'PROFESSOR_ALREADY_ASSIGNED', 'Professor is already assigned to another active group');
    }

    const now = new Date();

    // Update group with new advisor
    group.advisorId = newProfessorId;
    group.advisorStatus = 'transferred';
    group.advisorUpdatedAt = now;
    await group.save();

    // Create AdvisorAssignment record for tracking
    const assignment = await AdvisorAssignment.create({
      assignmentId: `asn_${uuidv4().split('-')[0]}`,
      groupId,
      professorId: newProfessorId,
      previousProfessorId: previousAdvisorId,
      status: 'transferred',
      updatedAt: now,
      updatedBy: transferredBy,
      reason: reason || 'Coordinator transferred advisor',
    });

    // Create audit log
    try {
      await createAuditLog({
        action: 'status_transition',
        actorId: transferredBy,
        groupId,
        payload: {
          previous_status: previousAdvisorId ? 'assigned' : 'none',
          new_status: 'transferred',
          reason: reason || 'Coordinator transferred advisor',
          previousAdvisorId,
          newAdvisorId: newProfessorId,
          assignmentId: assignment.assignmentId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });
    } catch (auditErr) {
      console.error('Audit log failed (non-fatal):', auditErr.message);
    }

    return {
      groupId,
      professorId: newProfessorId,
      status: 'transferred',
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof AdvisorServiceError) {
      throw error;
    }
    console.error('advisorService.transferAdvisor error:', error);
    throw new AdvisorServiceError(500, 'SERVER_ERROR', 'An error occurred while transferring the advisor');
  }
};

module.exports = {
  approveAdvisorRequest,
  releaseAdvisor,
  transferAdvisor,
  AdvisorServiceError,
};
