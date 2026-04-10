const Deliverable = require('../models/Deliverable');
const SprintRecord = require('../models/SprintRecord');
const Committee = require('../models/Committee');
const Group = require('../models/Group');
const ScheduleWindow = require('../models/ScheduleWindow');
const { createAuditLog } = require('./auditService');

class DeliverableServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'DeliverableServiceError';
    this.status = status;
  }
}

/**
 * Validate committee assignment
 */
const validateCommitteeAssignment = async (committeeId, groupId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new DeliverableServiceError('Committee not found', 404);
  }

  if (committee.status !== 'published') {
    throw new DeliverableServiceError('Committee must be published for submissions', 409);
  }

  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new DeliverableServiceError('Group not found', 404);
  }

  return { committee, group };
};

/**
 * Store deliverable in D4
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
 * Create or update sprint record
 */
const createOrUpdateSprintRecord = async (sprintId, groupId, committeeId, session = null) => {
  let sprintRecord = await SprintRecord.findOne({ sprintId, groupId }).session(session);

  if (sprintRecord) {
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

  await sprintRecord.save({ session });
  return sprintRecord;
};

/**
 * Issue #86: Link D4 deliverable to D6 sprint record (Flow f14: D4 → D6)
 * Ingests D4 reference into D6 deliverableRefs array
 */
const linkD4ToD6 = async (deliverableId, sprintId, groupId, type, session = null) => {
  const sprintRecord = await SprintRecord.findOne({ sprintId, groupId }).session(session);
  if (!sprintRecord) {
    throw new DeliverableServiceError('Sprint record not found', 404);
  }

  const deliverableRef = {
    deliverableId,
    type,
    submittedAt: new Date(),
  };

  sprintRecord.deliverableRefs.push(deliverableRef);
  await sprintRecord.save({ session });

  console.log(`[D6 Update f14] Linked deliverable ${deliverableId} to sprint record ${sprintRecord.sprintRecordId}`);
  return sprintRecord;
};

/**
 * Submit deliverable with atomic D4/D6 writes
 */
const submitDeliverable = async (submissionData) => {
  const { committeeId, groupId, studentId, sprintId, type, storageRef, submittedBy } = submissionData;

  await validateCommitteeAssignment(committeeId, groupId);

  const session = await Deliverable.startSession();
  session.startTransaction();

  try {
    // Flow f12: 4.5 → D4 - Store deliverable in D4
    const deliverable = await storeDeliverableInD4({
      committeeId,
      groupId,
      studentId,
      type,
      storageRef,
    });

    // Flow f13: 4.5 → D6 - Create or update sprint record
    await createOrUpdateSprintRecord(sprintId, groupId, committeeId, session);

    // Flow f14: D4 → D6 - Link D4 to D6 cross-reference
    await linkD4ToD6(deliverable.deliverableId, sprintId, groupId, type, session);

    await createAuditLog({
      event: 'DELIVERABLE_SUBMITTED',
      userId: submittedBy,
      entityType: 'Deliverable',
      entityId: deliverable.deliverableId,
      changes: { committeeId, groupId, type, status: 'submitted' },
    });

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
