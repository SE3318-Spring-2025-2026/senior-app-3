const Committee = require('../models/Committee');
const Group = require('../models/Group');
const { createAuditLog } = require('./auditService');
const { sendCommitteeNotification } = require('./committeeNotificationService');

/**
 * Issue #87: Custom error class for committee operations
 * Used throughout Process 4.0-4.5 with HTTP status codes
 */
class CommitteeServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'CommitteeServiceError';
    this.status = status;
  }
}

/**
 * Create committee draft (Process 4.1)
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
 * Validate committee setup (Process 4.4)
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
  if (!committee.advisorIds || committee.advisorIds.length === 0) {
    errors.push('At least one advisor must be assigned');
  }
  if (!committee.juryIds || committee.juryIds.length === 0) {
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
 * Issue #87: Publish committee with notification dispatch
 * Process 4.5: Committee Publication with Notification Service Integration
 * 
 * Workflow:
 * 1. Validate committee exists and is in 'validated' status
 * 2. Update D3 record: status → 'published', set publishedAt timestamp
 * 3. Log audit event for publication
 * 4. **CRITICAL**: Dispatch notifications to all stakeholders (Issue #87 Flow f09)
 *    - Recipients = advisorIds + juryIds + groupMemberIds (deduplicated)
 *    - Uses retry logic (3 attempts, backoff [100ms, 200ms, 400ms])
 *    - Returns notificationTriggered flag (true if successful, false if failed)
 * 5. Return response with notificationTriggered in schema (OpenAPI: CommitteePublish)
 * 
 * DFD Flows:
 * - f05: 4.4 → 4.5 (validated committee)
 * - f06: 4.5 → D3 (publish record)
 * - f09: 4.5 → Notification Service (dispatch notifications)
 * - f08: 4.5 → Coordinator (publish status)
 * 
 * Error Handling:
 * - Notification failure does NOT block committee publish (partial failure)
 * - Failure is logged to audit trail with committeeId and error message
 * - notificationTriggered flag indicates success/failure to caller
 */
const publishCommittee = async (committeeId, publishedBy) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }

  if (committee.status !== 'validated') {
    throw new CommitteeServiceError(
      'Committee must be validated before publishing',
      409
    );
  }

  if (committee.status === 'published') {
    throw new CommitteeServiceError('Committee is already published', 409);
  }

  committee.status = 'published';
  committee.publishedAt = new Date();
  committee.publishedBy = publishedBy;
  await committee.save();

  await createAuditLog({
    event: 'COMMITTEE_PUBLISHED',
    userId: publishedBy,
    entityType: 'Committee',
    entityId: committeeId,
    changes: { status: 'published', publishedAt: committee.publishedAt },
  });

  /**
   * Issue #87: Flow f09 - Dispatch notification to Notification Service
   * 
   * This is the key integration point for Issue #87.
   * 
   * Steps:
   * 1. Collect all group members that will receive notifications
   * 2. Aggregate recipients: Set(advisorIds ∪ juryIds ∪ groupMemberIds) - removes duplicates
   * 3. Call sendCommitteeNotification() with retry logic
   * 4. Capture notificationTriggered flag (success/failure)
   * 5. Include in response for caller to track notification status
   * 
   * Even if notification dispatch fails, committee remains published (partial failure model).
   * Failure is logged to audit trail for manual follow-up if needed.
   */
  const groups = await Group.find().lean();
  const groupMemberIds = [];
  groups.forEach((g) => {
    if (g.members && Array.isArray(g.members)) {
      groupMemberIds.push(...g.members);
    }
  });

  const notificationResult = await sendCommitteeNotification(
    committee,
    groupMemberIds,
    publishedBy
  );

  return {
    ...committee.toObject(),
    /**
     * Issue #87: Notification Triggered Flag
     * 
     * Schema: CommitteePublish.notificationTriggered (boolean, required)
     * 
     * - true: Notification was successfully dispatched to Notification Service
     * - false: Notification dispatch failed after 3 retries
     * 
     * Used by coordinator to verify notification delivery status without blocking publish.
     */
    notificationTriggered: notificationResult.success,
    notificationId: notificationResult.notificationId || null,
  };
};

/**
 * Get committee by ID
 */
const getCommittee = async (committeeId) => {
  const committee = await Committee.findOne({ committeeId });
  if (!committee) {
    throw new CommitteeServiceError('Committee not found', 404);
  }
  return committee;
};

/**
 * Assign advisors to committee (Process 4.2)
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
 * Assign jury members to committee (Process 4.3)
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
  CommitteeServiceError,
};
