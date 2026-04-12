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
 * Store deliverable in D4 (Flow f12: 4.5 → D4)
 * 
 * ISSUE #86 ATOMICITY FIX - Orphan Record Bug:
 * ────────────────────────────────────────────────────────────────────────────────
 * BEFORE: Function signature had NO session parameter
 *         await deliverable.save() executed without session
 *         Result: D4 write isolated from D6 transaction → orphan records if D6 fails
 * 
 * AFTER: Function now accepts session parameter and passes it to save()
 *        await deliverable.save({ session })
 *        Result: D4 write bound to active transaction → atomic with D6 ✓
 * 
 * How It Works:
 * - If session = null → Standalone write (not transactional)
 * - If session exists → Write bound to active MongoDB transaction
 * - MongoDB guarantee: All writes in session either commit together or rollback together
 * 
 * Impact: D4 and D6 are now guaranteed to stay in sync
 *         No orphan D4 records even if D6 update fails
 *         Full atomicity across D4→D6 cross-reference ✓
 * ────────────────────────────────────────────────────────────────────────────────
 * 
 * @param {object} deliverableData - Submission data (committeeId, groupId, studentId, type, storageRef)
 * @param {object} session - MongoDB session for transaction binding (ISSUE #86: REQUIRED for atomicity)
 * @returns {Promise<object>} Stored deliverable document
 */
const storeDeliverableInD4 = async (deliverableData, session = null) => {
  const deliverableId = `DEL_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const deliverable = new Deliverable({
    deliverableId,
    ...deliverableData,
    status: 'submitted',
  });

  // ISSUE #86 FIX: Pass session to bind D4 write to active transaction
  // Before: await deliverable.save() → isolated write → orphan if D6 fails
  // After: await deliverable.save({ session }) → atomic with D6 ✓
  await deliverable.save({ session });
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
    // ISSUE #86 FIX: Pass session to storeDeliverableInD4 to bind D4 write to transaction
    // This ensures D4 write is part of the same atomic transaction as D6 writes
    const deliverable = await storeDeliverableInD4({
      committeeId,
      groupId,
      studentId,
      type,
      storageRef,
    }, session);  // ✅ ISSUE #86: Session passed - D4 write now atomic with D6

    // Flow f13: 4.5 → D6 - Create or update sprint record
    // Session passed → write bound to transaction
    await createOrUpdateSprintRecord(sprintId, groupId, committeeId, session);

    // Flow f14: D4 → D6 - Link D4 to D6 cross-reference
    // Session passed → link bound to transaction
    await linkD4ToD6(deliverable.deliverableId, sprintId, groupId, type, session);

    // ISSUE #86 FIX: Pass session to createAuditLog to ensure audit log is atomic
    // Before: createAuditLog called without session → audit outside transaction
    // After: createAuditLog called with session → audit part of transaction ✓
    // Impact: If transaction fails, audit log is also rolled back (no orphan audit entries)
    await createAuditLog({
      event: 'DELIVERABLE_SUBMITTED',
      userId: submittedBy,
      entityType: 'Deliverable',
      entityId: deliverable.deliverableId,
      changes: { committeeId, groupId, type, status: 'submitted' },
    }, { session });  // ✅ ISSUE #86: Session passed - audit log now atomic

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
