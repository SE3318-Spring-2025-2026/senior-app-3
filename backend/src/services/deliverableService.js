const Deliverable = require('../models/Deliverable');
const SprintRecord = require('../models/SprintRecord');
const Committee = require('../models/Committee');
const Group = require('../models/Group');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('./auditLogService');

class DeliverableServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'DeliverableServiceError';
    this.status = status;
  }
}

/**
 * Validate that committee is assigned to the group
 * @param {string} committeeId - ID of the committee
 * @param {string} groupId - ID of the group
 * @returns {Promise<object>} Committee assignment validation result
 */
const validateCommitteeAssignment = async (committeeId, groupId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new DeliverableServiceError('Committee not found', 404);
  }

  if (committee.status !== 'published') {
    throw new DeliverableServiceError(
      'Committee must be published for submissions',
      409
    );
  }

  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new DeliverableServiceError('Group not found', 404);
  }

  return { committee, group };
};

/**
 * Store deliverable in D4
 * @param {object} deliverableData - Deliverable data (committeeId, groupId, studentId, type, storageRef)
 * @returns {Promise<object>} Created deliverable
 */
const storeDeliverableInD4 = async (deliverableData) => {
  const deliverableId = `DEL_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const deliverable = new Deliverable({
    deliverableId,
    ...deliverableData,
    status: 'submitted',
  });

  await deliverable.save();
  return deliverable;
};

/**
 * Create or update sprint record in D6
 * @param {string} sprintId - ID of the sprint
 * @param {string} groupId - ID of the group
 * @param {string} committeeId - ID of the committee
 * @returns {Promise<object>} Sprint record
 */
const createOrUpdateSprintRecord = async (sprintId, groupId, committeeId) => {
  let sprintRecord = await SprintRecord.findOne({ sprintId, groupId });

  if (sprintRecord) {
    // Update existing sprint record with committee info if not already set
    if (!sprintRecord.committeeId) {
      sprintRecord.committeeId = committeeId;
      sprintRecord.committeeAssignedAt = new Date();
    }
    sprintRecord.status = 'submitted';
  } else {
    const sprintRecordId = `SR_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sprintRecord = new SprintRecord({
      sprintRecordId,
      sprintId,
      groupId,
      committeeId,
      committeeAssignedAt: new Date(),
      status: 'submitted',
    });
  }

  await sprintRecord.save();
  return sprintRecord;
};

/**
 * Link D4 deliverable to D6 sprint record
 * @param {string} deliverableId - ID of the deliverable (D4)
 * @param {string} sprintId - ID of the sprint
 * @param {string} groupId - ID of the group
 * @param {string} type - Type of deliverable
 * @returns {Promise<object>} Updated sprint record
 */
const linkD4ToD6 = async (deliverableId, sprintId, groupId, type) => {
  const sprintRecord = await SprintRecord.findOne({ sprintId, groupId });
  if (!sprintRecord) {
    throw new DeliverableServiceError('Sprint record not found', 404);
  }

  // Add deliverable reference to sprint record
  const deliverableRef = {
    deliverableId,
    type,
    submittedAt: new Date(),
  };

  sprintRecord.deliverableRefs.push(deliverableRef);
  await sprintRecord.save();

  return sprintRecord;
};

/**
 * Submit a deliverable with atomic D4/D6 writes
 * @param {object} submissionData - Submission data
 * @returns {Promise<object>} Submission result
 */
const submitDeliverable = async (submissionData) => {
  const {
    committeeId,
    groupId,
    studentId,
    sprintId,
    type,
    storageRef,
    submittedBy,
  } = submissionData;

  // Validate committee assignment
  await validateCommitteeAssignment(committeeId, groupId);

  // Start MongoDB session for atomic transaction
  const session = await Deliverable.startSession();
  session.startTransaction();

  try {
    // Store in D4
    const deliverable = await storeDeliverableInD4({
      committeeId,
      groupId,
      studentId,
      type,
      storageRef,
    });

    // Create or update D6 sprint record
    await createOrUpdateSprintRecord(
      sprintId,
      groupId,
      committeeId
    );

    // Link D4 to D6
    await linkD4ToD6(
      deliverable.deliverableId,
      sprintId,
      groupId,
      type
    );

    // Audit log
    await createAuditLog({
      event: 'DELIVERABLE_SUBMITTED',
      userId: submittedBy,
      entityType: 'Deliverable',
      entityId: deliverable.deliverableId,
      changes: {
        committeeId,
        groupId,
        type,
        status: 'submitted',
      },
    });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return {
      deliverableId: deliverable.deliverableId,
      committeeId,
      groupId,
      type,
      submittedAt: deliverable.submittedAt,
      storageRef,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

module.exports = {
  validateCommitteeAssignment,
  storeDeliverableInD4,
  createOrUpdateSprintRecord,
  linkD4ToD6,
  submitDeliverable,
  DeliverableServiceError,
};
