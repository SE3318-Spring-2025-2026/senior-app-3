const Deliverable = require('../models/Deliverable');
const SprintRecord = require('../models/SprintRecord');
const Group = require('../models/Group');
const Committee = require('../models/Committee');
const { createAuditLog } = require('./auditService');

/**
 * Custom error class for deliverable service operations
 */
class DeliverableServiceError extends Error {
  constructor(message, status = 500, code = 'DELIVERABLE_ERROR') {
    super(message);
    this.name = 'DeliverableServiceError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate that a group is linked to a published committee.
 * 
 * @param {string} groupId - Group identifier
 * @returns {Promise<object>} Committee object if valid
 * @throws {DeliverableServiceError} If group not linked to published committee
 */
const validateCommitteeAssignment = async (groupId) => {
  try {
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      throw new DeliverableServiceError(
        `Group ${groupId} not found`,
        404,
        'GROUP_NOT_FOUND'
      );
    }

    if (!group.committeeId) {
      throw new DeliverableServiceError(
        `Group ${groupId} is not assigned to any committee`,
        400,
        'GROUP_NOT_LINKED_TO_COMMITTEE'
      );
    }

    const committee = await Committee.findOne({ 
      committeeId: group.committeeId,
      status: 'published'
    });
    
    if (!committee) {
      throw new DeliverableServiceError(
        `No published committee found for committee ID: ${group.committeeId}`,
        400,
        'COMMITTEE_NOT_PUBLISHED'
      );
    }

    return committee;
  } catch (err) {
    if (err instanceof DeliverableServiceError) {
      throw err;
    }
    throw new DeliverableServiceError(
      `Failed to validate committee assignment: ${err.message}`,
      500,
      'VALIDATION_ERROR'
    );
  }
};

/**
 * Store deliverable in D4 collection.
 * 
 * @param {object} data - Deliverable data
 * @param {string} data.committeeId - Committee identifier
 * @param {string} data.groupId - Group identifier
 * @param {string} data.studentId - Student identifier
 * @param {string} data.type - Deliverable type (proposal, statement-of-work, demonstration)
 * @param {string} data.storageRef - Storage reference (URL or file path)
 * @param {object} session - MongoDB session for atomic transaction
 * @returns {Promise<object>} Created Deliverable document
 */
const storeDeliverableInD4 = async (data, session = null) => {
  try {
    const { committeeId, groupId, studentId, type, storageRef, sprintId } = data;

    const deliverable = new Deliverable({
      committeeId,
      groupId,
      submittedBy: studentId,
      deliverableType: type,
      sprintId: sprintId || null,
      filePath: storageRef,
      fileSize: data.fileSize || 0,
      fileHash: data.fileHash || 'system-generated',
      format: data.format || 'unknown',
      submittedAt: new Date(),
      status: 'accepted',
    });

    await deliverable.save(session ? { session } : undefined);
    return deliverable;
  } catch (err) {
    throw new DeliverableServiceError(
      `Failed to store deliverable in D4: ${err.message}`,
      500,
      'D4_STORAGE_ERROR'
    );
  }
};

/**
 * Create or update sprint record with committee assignment.
 * 
 * @param {object} data - Sprint record data
 * @param {string} data.groupId - Group identifier
 * @param {string} data.sprintId - Sprint identifier
 * @param {string} data.committeeId - Committee identifier
 * @param {object} session - MongoDB session for atomic transaction
 * @returns {Promise<object>} SprintRecord document
 */
const createOrUpdateSprintRecord = async (data, session = null) => {
  try {
    const { groupId, sprintId, committeeId } = data;

    let sprintRecord = await SprintRecord.findOne(
      { sprintId, groupId },
      null,
      session ? { session } : undefined
    );

    if (sprintRecord) {
      // Update existing sprint record
      sprintRecord.committeeId = committeeId;
      sprintRecord.committeeAssignedAt = new Date();
      sprintRecord.status = sprintRecord.status === 'pending' ? 'in_progress' : sprintRecord.status;
      await sprintRecord.save(session ? { session } : undefined);
    } else {
      // Create new sprint record
      sprintRecord = new SprintRecord({
        sprintId,
        groupId,
        committeeId,
        committeeAssignedAt: new Date(),
        status: 'in_progress',
      });
      await sprintRecord.save(session ? { session } : undefined);
    }

    return sprintRecord;
  } catch (err) {
    throw new DeliverableServiceError(
      `Failed to create/update sprint record in D6: ${err.message}`,
      500,
      'D6_UPDATE_ERROR'
    );
  }
};

/**
 * Establish D4-to-D6 cross-reference link.
 * 
 * @param {object} data - Cross-reference data
 * @param {string} data.deliverableId - Deliverable identifier (D4)
 * @param {string} data.sprintId - Sprint identifier (D6)
 * @param {string} data.groupId - Group identifier
 * @param {string} data.type - Deliverable type
 * @param {Date} data.submittedAt - Submission timestamp
 * @param {object} session - MongoDB session for atomic transaction
 * @returns {Promise<object>} Updated SprintRecord document
 */
const linkD4ToD6 = async (data, session = null) => {
  try {
    const { deliverableId, sprintId, groupId, type, submittedAt } = data;

    const sprintRecord = await SprintRecord.findOne({ sprintId, groupId }).session(session || undefined);

    if (!sprintRecord) {
      throw new DeliverableServiceError(
        `Sprint record not found for cross-reference: sprintId=${sprintId}, groupId=${groupId}`,
        404,
        'SPRINT_RECORD_NOT_FOUND'
      );
    }

    const alreadyLinked = sprintRecord.deliverableRefs.some((ref) => ref.deliverableId === deliverableId);

    if (!alreadyLinked) {
      sprintRecord.deliverableRefs.push({
        deliverableId,
        type,
        submittedAt,
      });
      await sprintRecord.save({ session: session || undefined });
    }

    return sprintRecord;
  } catch (err) {
    if (err instanceof DeliverableServiceError) {
      throw err;
    }
    throw new DeliverableServiceError(
      `Failed to establish D4-to-D6 cross-reference: ${err.message}`,
      500,
      'CROSS_REFERENCE_ERROR'
    );
  }
};

/**
 * Complete deliverable submission workflow with atomic D4/D6 writes.
 * 
 * @param {object} data - Submission data
 * @param {string} data.groupId - Group identifier
 * @param {string} data.committeeId - Committee identifier
 * @param {string} data.sprintId - Sprint identifier
 * @param {string} data.studentId - Student identifier
 * @param {string} data.type - Deliverable type
 * @param {string} data.storageRef - Storage reference
 * @param {string} data.coordinatorId - Coordinator performing submission (for audit)
 * @returns {Promise<object>} { deliverableId, committeeId, groupId, type, submittedAt, storageRef }
 */
const submitDeliverable = async (data) => {
  const session = await Deliverable.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const { groupId, committeeId, sprintId, studentId, type, storageRef, coordinatorId } = data;

      // Step 1: Store deliverable in D4
      const deliverable = await storeDeliverableInD4(
        { committeeId, groupId, studentId, type, storageRef },
        session
      );

      // Step 2: Create or update sprint record in D6
      const sprintRecord = await createOrUpdateSprintRecord(
        { groupId, sprintId, committeeId },
        session
      );

      // Step 3: Establish D4-to-D6 cross-reference
      await linkD4ToD6(
        {
          deliverableId: deliverable.deliverableId,
          sprintId: sprintRecord.sprintId,
          groupId,
          type,
          submittedAt: deliverable.submittedAt,
        },
        session
      );

      // Step 4: Create audit log
      await createAuditLog(
        {
          action: 'DELIVERABLE_SUBMITTED',
          actorId: coordinatorId || studentId,
          groupId,
          payload: {
            deliverableId: deliverable.deliverableId,
            committeeId,
            type,
            sprintId,
          },
        },
        session
      );

      result = {
        deliverableId: deliverable.deliverableId,
        committeeId,
        groupId,
        type,
        submittedAt: deliverable.submittedAt,
        storageRef,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof DeliverableServiceError) {
      throw err;
    }
    throw new DeliverableServiceError(
      `Deliverable submission failed: ${err.message}`,
      500,
      'SUBMISSION_ERROR'
    );
  } finally {
    await session.endSession();
  }
};

module.exports = {
  DeliverableServiceError,
  validateCommitteeAssignment,
  storeDeliverableInD4,
  createOrUpdateSprintRecord,
  linkD4ToD6,
  submitDeliverable,
};
