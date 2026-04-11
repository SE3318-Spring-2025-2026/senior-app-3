/**
 * AdvisorAssignmentRepository
 *
 * Data Access Layer (DAO) for advisor assignment operations.
 * Handles all read and write operations on advisor-related fields in D2 (groups collection).
 *
 * Flows: f03 (3.2 → D2), f08 (3.5 → D2), f13 (3.7 → D2)
 * Issue #68 & #69 - Data Integrity & Notification Tracking
 */

const Group = require('../models/Group');
const { v4: uuidv4 } = require('uuid');

/**
 * CREATE OPERATIONS
 */

/**
 * Create advisor request record (Write Operation f03: 3.2 → D2)
 * Persists the advisor request as an embedded subdocument.
 */
async function createAdvisorRequest(groupId, requestData) {
  const requestId = `adv_req_${uuidv4().split('-')[0]}`;

  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorRequest: {
          requestId,
          professorId: requestData.professorId,
          requestedBy: requestData.requesterId,
          status: 'pending',
          message: requestData.message || null,
          notificationTriggered: requestData.notificationTriggered || false,
          createdAt: new Date(),
        },
        advisorStatus: 'pending',
        advisorRequestId: requestId, // Flat reference for fast lookups
        advisorUpdatedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) throw new Error(`Group ${groupId} not found`);
  return group;
}

/**
 * UPDATE OPERATIONS
 */

/**
 * Approve advisor request and assign advisor (Write Operation f08: 3.5 → D2)
 */
async function assignAdvisor(groupId, professorId, options = {}) {
  const group = await Group.findOneAndUpdate(
    { groupId },
    {
      $set: {
        advisorId: professorId,
        advisorStatus: 'assigned',
        'advisorRequest.status': 'approved',
        'advisorRequest.approvedAt': new Date(),
        advisorUpdatedAt: new Date(),
        advisorAssignedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) throw new Error(`Group ${groupId} not found`);
  return group;
}

/**
 * FIX #4: ATOMIC REPOSITORY OPERATIONS (releaseAdvisor)
 * Guard condition: Only update if advisor currently assigned to prevent race conditions.
 */
async function releaseAdvisor(groupId) {
  const updated = await Group.findOneAndUpdate(
    {
      groupId,
      advisorId: { $ne: null }, // GUARD: Atomicity check
    },
    {
      $set: {
        advisorId: null,
        advisorStatus: 'released',
        advisorRequestId: null,
        advisorUpdatedAt: new Date(),
        advisorAssignedAt: null,
      },
    },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new Error(`Group ${groupId} not found or has no assigned advisor to release`);
  }
  return updated;
}

/**
 * FIX #4: ATOMIC REPOSITORY OPERATIONS (transferAdvisor)
 */
async function transferAdvisor(groupId, newProfessorId) {
  const updated = await Group.findOneAndUpdate(
    {
      groupId,
      advisorId: { $ne: null }, // GUARD: Atomicity check
    },
    {
      $set: {
        advisorId: newProfessorId,
        advisorStatus: 'transferred',
        advisorUpdatedAt: new Date(),
        advisorAssignedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new Error(`Group ${groupId} not found or has no assigned advisor to transfer`);
  }
  return updated;
}

/**
 * Disband group and clear advisor (Process 3.7)
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
        status: 'archived', 
      },
    },
    { new: true, runValidators: true }
  );

  if (!group) throw new Error(`Group ${groupId} not found`);
  return group;
}

/**
 * Update notification triggered flag (Issue #69)
 * Uses requestId for exact subdocument matching.
 */
async function markNotificationTriggered(requestId) {
  if (!requestId) throw new Error('markNotificationTriggered: requestId is required');

  const updated = await Group.findOneAndUpdate(
    { 'advisorRequest.requestId': requestId },
    {
      $set: {
        'advisorRequest.notificationTriggered': true,
        'advisorRequest.updatedAt': new Date(),
      },
    },
    { new: true }
  );

  if (!updated) {
    throw new Error(`AdvisorRequest ${requestId} not found`);
  }
  return updated;
}

/**
 * READ OPERATIONS
 */

async function getAdvisorRequest(groupId) {
  const group = await Group.findOne({ groupId }, { advisorRequest: 1 }).lean();
  return group?.advisorRequest || null;
}

async function getAdvisorAssignment(groupId) {
  const group = await Group.findOne(
    { groupId },
    { advisorId: 1, advisorStatus: 1, advisorUpdatedAt: 1 }
  ).lean();

  if (!group) return null;
  return {
    advisorId: group.advisorId,
    advisorStatus: group.advisorStatus,
    advisorUpdatedAt: group.advisorUpdatedAt,
  };
}

async function hasAdvisorConflict(groupId) {
  const group = await Group.findOne(
    { groupId },
    { advisorId: 1, advisorStatus: 1, 'advisorRequest.status': 1 }
  ).lean();

  if (!group) return false;
  const hasAdvisor = group.advisorId && group.advisorStatus === 'assigned';
  const hasPendingRequest = group.advisorRequest?.status === 'pending';

  return hasAdvisor || hasPendingRequest;
}

async function getGroupsWithoutAdvisor() {
  return Group.find(
    {
      $or: [
        { advisorId: null },
        { advisorStatus: { $in: [null, 'pending', 'released'] } },
      ],
    },
    { groupId: 1, groupName: 1, leaderId: 1, advisorStatus: 1 }
  ).lean();
}

async function getGroupsByAdvisor(professorId) {
  return Group.find(
    { advisorId: professorId, advisorStatus: 'assigned' },
    { groupId: 1, groupName: 1, leaderId: 1, advisorUpdatedAt: 1 }
  ).lean();
}

module.exports = {
  createAdvisorRequest,
  assignAdvisor,
  releaseAdvisor,
  transferAdvisor,
  disbandGroup,
  markNotificationTriggered,
  getAdvisorRequest,
  getAdvisorAssignment,
  hasAdvisorConflict,
  getGroupsWithoutAdvisor,
  getGroupsByAdvisor
};