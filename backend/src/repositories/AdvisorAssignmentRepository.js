/**
 * AdvisorAssignmentRepository
 *
 * Data Access Layer (DAO) for advisor assignment operations.
 * Handles all read and write operations on advisor-related fields in D2 (groups collection).
 *
 * Issue #68 - D2 Advisor Assignment Schema & Write Operations
 * Flows: f03 (3.2 → D2), f08 (3.5 → D2), f13 (3.7 → D2)
 */

const Group = require('../models/Group');
const { v4: uuidv4 } = require('uuid');

/**
 * CREATE OPERATIONS
 */

/**
 * Create advisor request record (Write Operation f03: 3.2 → D2)
 * Persists the advisor request after process 3.2 validation.
 * The request is embedded in the group's advisorRequest field.
 *
 * @param {string} groupId - Group identifier
 * @param {object} requestData - {
 *   professorId: string,
 *   requesterId: string,
 *   message?: string,
 *   notificationTriggered?: boolean
 * }
 * @returns {Promise<object>} Updated group document with embedded advisor request
 * @throws {Error} if group not found or validation fails
 */
async function createAdvisorRequest(groupId, requestData) {
  const requestId = `adv_req_${uuidv4().split('-')[0]}`;

  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorRequest: {
          requestId,
          groupId,
          professorId: requestData.professorId,
          requesterId: requestData.requesterId,
          status: 'pending',
          message: requestData.message || null,
          notificationTriggered: requestData.notificationTriggered || false,
          createdAt: new Date(),
        },
        advisorStatus: 'pending',
        advisorRequestId: requestId,
        advisorUpdatedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  return group;
}

/**
 * UPDATE OPERATIONS
 */

/**
 * Approve advisor request and assign advisor (Write Operation f08: 3.5 → D2 — assign path)
 * Updates group with assigned advisor and changes status to 'assigned'.
 * Called after process 3.4 (advisor decision) approves the request.
 *
 * @param {string} groupId - Group identifier
 * @param {string} professorId - Professor to assign as advisor
 * @param {object} options - { requestId?, notificationTriggered? }
 * @returns {Promise<object>} Updated group document
 * @throws {Error} if group not found
 */
async function assignAdvisor(groupId, professorId, options = {}) {
  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorId: professorId,
        advisorStatus: 'assigned',
        advisorRequestId: options.requestId || null,
        advisorUpdatedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  return group;
}

/**
 * Release advisor from group (Write Operation f08: 3.5 → D2 — release path)
 * Clears advisorId, updates status to 'released', and allows new requests.
 * Called when Team Leader or Coordinator releases the advisor.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object>} Updated group document with cleared advisor
 * @throws {Error} if group not found or has no assigned advisor
 */
async function releaseAdvisor(groupId) {
  const group = await Group.findOne({ groupId });

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  if (!group.advisorId) {
    throw new Error(`Group ${groupId} has no assigned advisor to release`);
  }

  const updated = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorId: null,
        advisorStatus: 'released',
        advisorRequestId: null,
        advisorUpdatedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  return updated;
}

/**
 * Transfer advisor to new professor (Write Operation f08: 3.5 → D2 — transfer path)
 * Replaces current advisor with new professor and updates status to 'transferred'.
 * Called by process 3.5 after coordinator (3.6) requests transfer.
 *
 * @param {string} groupId - Group identifier
 * @param {string} newProfessorId - New professor to assign
 * @returns {Promise<object>} Updated group document with new advisor
 * @throws {Error} if group not found or has no assigned advisor
 */
async function transferAdvisor(groupId, newProfessorId) {
  const group = await Group.findOne({ groupId });

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  if (!group.advisorId) {
    throw new Error(`Group ${groupId} has no assigned advisor to transfer`);
  }

  const updated = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorId: newProfessorId,
        advisorStatus: 'transferred',
        advisorUpdatedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  return updated;
}

/**
 * Disband group and clear advisor (Write Operation f13: 3.7 → D2)
 * Sets status to 'disbanded' and clears advisorId.
 * Called by sanitization process 3.7 for groups without assigned advisor.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object>} Updated group document
 * @throws {Error} if group not found
 */
async function disbandGroup(groupId) {
  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorId: null,
        advisorStatus: 'disbanded',
        advisorRequestId: null,
        advisorUpdatedAt: new Date(),
        status: 'archived', // Disband transitions group to archived
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  return group;
}

/**
 * READ OPERATIONS
 */

/**
 * Get advisor request for a group
 * Used to check pending request status before allowing new requests.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object|null>} Advisor request object or null if none exists
 */
async function getAdvisorRequest(groupId) {
  const group = await Group.findOne(
    { groupId },
    { advisorRequest: 1 }
  );

  return group?.advisorRequest || null;
}

/**
 * Get advisor assignment status for a group
 * Checks if group has pending/assigned/released/transferred/disbanded advisor status.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object|null>} { advisorId, advisorStatus, advisorUpdatedAt } or null
 */
async function getAdvisorAssignment(groupId) {
  const group = await Group.findOne(
    { groupId },
    { advisorId: 1, advisorStatus: 1, advisorUpdatedAt: 1 }
  );

  if (!group) return null;

  return {
    advisorId: group.advisorId,
    advisorStatus: group.advisorStatus,
    advisorUpdatedAt: group.advisorUpdatedAt,
  };
}

/**
 * Check for existing advisor or pending request conflict
 * Ensures group doesn't have both an advisor and a pending request.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<boolean>} true if conflict exists
 */
async function hasAdvisorConflict(groupId) {
  const group = await Group.findOne(
    { groupId },
    { advisorId: 1, advisorStatus: 1, advisorRequest: 1 }
  );

  if (!group) return false;

  // Conflict if:
  // 1. Group has an assigned advisor
  // 2. Group has a pending advisor request
  const hasAdvisor = group.advisorId && group.advisorStatus === 'assigned';
  const hasPendingRequest =
    group.advisorRequest?.status === 'pending';

  return hasAdvisor || hasPendingRequest;
}

/**
 * Get all groups without assigned advisor after deadline
 * Used by sanitization process 3.7 to find groups for disband.
 *
 * @returns {Promise<Array>} Array of group documents without advisor
 */
async function getGroupsWithoutAdvisor() {
  const groups = await Group.find(
    {
      $or: [
        { advisorId: null },
        { advisorStatus: { $in: [null, 'pending', 'released'] } },
      ],
    },
    { groupId: 1, groupName: 1, leaderId: 1, advisorStatus: 1 }
  );

  return groups;
}

/**
 * Get groups assigned to a specific advisor
 * Used for advisor dashboard and conflict detection.
 *
 * @param {string} professorId - Professor identifier
 * @returns {Promise<Array>} Array of groups assigned to professor
 */
async function getGroupsByAdvisor(professorId) {
  const groups = await Group.find(
    { advisorId: professorId, advisorStatus: 'assigned' },
    { groupId: 1, groupName: 1, leaderId: 1, advisorUpdatedAt: 1 }
  );

  return groups;
}

/**
 * Update notification triggered flag for advisor request
 * Called after notification is successfully dispatched (Issue #69).
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object>} Updated group document
 */
async function markNotificationTriggered(groupId) {
  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        'advisorRequest.notificationTriggered': true,
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  return group;
}

/**
 * Clear advisor request after decision (approve/reject)
 * Removes the request from the group after it's been processed.
 *
 * @param {string} groupId - Group identifier
 * @returns {Promise<object>} Updated group document
 */
async function clearAdvisorRequest(groupId) {
  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorRequest: null,
        advisorRequestId: null,
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  return group;
}

module.exports = {
  // Create operations
  createAdvisorRequest,

  // Update operations
  assignAdvisor,
  releaseAdvisor,
  transferAdvisor,
  disbandGroup,
  markNotificationTriggered,
  clearAdvisorRequest,

  // Read operations
  getAdvisorRequest,
  getAdvisorAssignment,
  hasAdvisorConflict,
  getGroupsWithoutAdvisor,
  getGroupsByAdvisor,
};
