const Committee = require('../models/Committee');
const SprintRecord = require('../models/SprintRecord');
const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');

class CommitteeServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'CommitteeServiceError';
    this.status = status;
  }
}

/**
 * Create committee draft
 */
const createCommitteeDraft = async (committeeName, coordinatorId, options = {}) => {
  const existingCommittee = await Committee.findOne({ committeeName });
  if (existingCommittee) {
    throw new CommitteeServiceError(
      `Committee with name "${committeeName}" already exists`,
      409
    );
  }

  const committeeId = `COMM_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const committee = new Committee({
    committeeId,
    committeeName,
    createdBy: coordinatorId,
    status: 'draft',
    description: options.description || '',
    advisorIds: options.advisorIds || [],
    juryIds: options.juryIds || [],
  });

  await committee.save();

  await createAuditLog({
    event: 'COMMITTEE_CREATED',
    userId: coordinatorId,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { status: 'draft', committeeName },
  });

  return committee;
};

/**
 * Validate committee setup
 */
const validateCommittee = async (committeeId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Cannot validate a published committee', 409);
  }

  const errors = [];
  if (committee.advisorIds.length === 0) {
    errors.push('At least one advisor must be assigned');
  }
  if (committee.juryIds.length === 0) {
    errors.push('At least one jury member must be assigned');
  }

  if (errors.length > 0) {
    throw new CommitteeServiceError(`Validation failed: ${errors.join('; ')}`, 400);
  }

  committee.status = 'validated';
  committee.validatedAt = new Date();
  committee.validatedBy = committee.createdBy;
  await committee.save();

  await createAuditLog({
    event: 'COMMITTEE_VALIDATED',
    userId: committee.createdBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { status: 'validated' },
  });

  return committee;
};

/**
 * Issue #86: Update D6 sprint records on committee publish (Flow f13: 4.5 → D6)
 * Atomic operation: all sprint records updated together or none
 */
const updateSprintRecordsOnPublish = async (committeeId, session = null) => {
  console.log(`[D6 Update f13] Starting sprint record update for committee ${committeeId}`);

  const committee = await Committee.findOne({ committeeId }).session(session);
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  // Find all groups and their sprint records
  const groups = await Group.find().session(session);
  const updatedRecords = [];

  for (const group of groups) {
    const sprintRecords = await SprintRecord.find({
      groupId: group.groupId,
    }).session(session);

    for (const sprintRecord of sprintRecords) {
      if (!sprintRecord.committeeId) {
        sprintRecord.committeeId = committeeId;
        sprintRecord.committeeAssignedAt = new Date();
        await sprintRecord.save({ session });
        updatedRecords.push(sprintRecord.sprintRecordId);
        console.log(`[D6 Update f13] Updated sprint record ${sprintRecord.sprintRecordId} with committee ${committeeId}`);
      }
    }
  }

  // ISSUE #86 FIX: Pass session to createAuditLog to ensure audit log atomicity
  // Before: createAuditLog called without session → audit outside transaction
  // After: createAuditLog called with session → audit part of transaction ✓
  // 
  // Why This Matters:
  // - Function is inside updateSprintRecordsOnPublish which receives session parameter
  // - All D6 writes (sprintRecord.save({ session })) are bound to transaction
  // - Audit log MUST also be bound to same transaction
  // - Without session: audit succeeds but transaction fails → inconsistent state
  // - With session: both succeed or both fail → consistent state ✓
  await createAuditLog({
    event: 'SPRINT_RECORDS_UPDATED',
    userId: committee.publishedBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { committeeAssignedAt: new Date(), recordsUpdated: updatedRecords.length },
  }, { session });  // ✅ ISSUE #86: Session passed - audit now atomic with D6 writes

  return { updatedCount: updatedRecords.length, recordIds: updatedRecords };
};

/**
 * Publish committee with atomic D6 updates
 */
const publishCommittee = async (committeeId, publishedBy) => {
  const session = await Committee.startSession();
  session.startTransaction();

  try {
    const committee = await Committee.findOne({ committeeId }).session(session);
    if (!committee) {
      throw new CommitteeServiceError('Committee not found', 404);
    }

    if (committee.status !== 'validated') {
      throw new CommitteeServiceError(
        'Committee must be validated before publishing',
        409
      );
    }

    committee.status = 'published';
    committee.publishedAt = new Date();
    committee.publishedBy = publishedBy;
    await committee.save({ session });

    // Issue #86: Atomically update D6 sprint records (Flow f13)
    await updateSprintRecordsOnPublish(committeeId, session);

    await createAuditLog({
      event: 'COMMITTEE_PUBLISHED',
      userId: publishedBy,
      entityType: 'Committee',
      entityId: committeeId,
      changes: { status: 'published', publishedAt: committee.publishedAt },
    });

    await session.commitTransaction();
    session.endSession();

    return committee;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Get committee
 */
const getCommittee = async (committeeId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }
  return committee;
};

/**
 * Assign advisors
 */
const assignAdvisors = async (committeeId, advisorIds) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Cannot modify a published committee', 409);
  }

  const uniqueAdvisors = [...new Set([...committee.advisorIds, ...advisorIds])];
  committee.advisorIds = uniqueAdvisors;
  await committee.save();

  await createAuditLog({
    event: 'COMMITTEE_ADVISORS_ASSIGNED',
    userId: committee.createdBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { advisorIds: uniqueAdvisors },
  });

  return committee;
};

/**
 * Assign jury members
 */
const assignJury = async (committeeId, juryIds) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Cannot modify a published committee', 409);
  }

  const uniqueJury = [...new Set([...committee.juryIds, ...juryIds])];
  committee.juryIds = uniqueJury;
  await committee.save();

  await createAuditLog({
    event: 'COMMITTEE_JURY_ASSIGNED',
    userId: committee.createdBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { juryIds: uniqueJury },
  });

  return committee;
};

module.exports = {
  createCommitteeDraft,
  validateCommittee,
  publishCommittee,
  getCommittee,
  assignAdvisors,
  assignJury,
  updateSprintRecordsOnPublish,
  CommitteeServiceError,
};
