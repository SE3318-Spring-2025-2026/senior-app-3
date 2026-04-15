'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Test data fixtures for review assignment and comment tests.
 * Provides factories for creating mock database objects for review workflows.
 */

/**
 * Generate a unique ID with prefix and timestamp
 * @param {string} prefix
 * @returns {string}
 */
function generateUniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Fixture: Create a valid User object
 * @param {Object} overrides
 * @returns {Object}
 */
function createUser(overrides = {}) {
  const userId = overrides.userId || generateUniqueId('usr');
  return {
    userId,
    email: `${userId}@test.edu`,
    firstName: 'Test',
    lastName: 'User',
    hashedPassword: '$2b$10$mock_hash',
    role: 'student',
    accountStatus: 'active',
    emailVerified: true,
    ...overrides,
  };
}

/**
 * Fixture: Create a coordinator User object
 * @param {Object} overrides
 * @returns {Object}
 */
function createCoordinator(overrides = {}) {
  return createUser({
    role: 'coordinator',
    ...overrides,
  });
}

/**
 * Fixture: Create a professor/committee member User object
 * @param {Object} overrides
 * @returns {Object}
 */
function createCommitteeMember(overrides = {}) {
  return createUser({
    role: 'professor',
    ...overrides,
  });
}

/**
 * Fixture: Create a Group object
 * @param {Object} overrides
 * @returns {Object}
 */
function createGroup(overrides = {}) {
  const groupId = overrides.groupId || generateUniqueId('grp');
  const leaderId = overrides.leaderId || generateUniqueId('stu');

  return {
    groupId,
    groupName: `Group-${groupId}`,
    leaderId,
    status: 'active',
    members: [
      {
        userId: leaderId,
        role: 'leader',
        status: 'accepted',
        joinedAt: new Date(),
      },
    ],
    ...overrides,
  };
}

/**
 * Fixture: Create a Committee object
 * @param {Object} overrides
 * @returns {Object}
 */
function createCommittee(overrides = {}) {
  const committeeId = overrides.committeeId || generateUniqueId('cmt');
  const advisorIds = overrides.advisorIds || [
    generateUniqueId('prof_adv'),
    generateUniqueId('prof_adv'),
    generateUniqueId('prof_adv'),
  ];

  return {
    committeeId,
    committeeName: `Committee-${committeeId}`,
    description: 'Test committee',
    advisorIds,
    juryIds: overrides.juryIds || [generateUniqueId('prof_jury')],
    status: 'published',
    createdBy: generateUniqueId('coord'),
    publishedAt: new Date(),
    publishedBy: generateUniqueId('coord'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Fixture: Create a Deliverable object
 * @param {Object} overrides
 * @returns {Object}
 */
function createDeliverable(overrides = {}) {
  const deliverableId = overrides.deliverableId || generateUniqueId('del');
  const committeeId = overrides.committeeId || generateUniqueId('cmt');
  const groupId = overrides.groupId || generateUniqueId('grp');
  const studentId = overrides.studentId || generateUniqueId('stu');

  return {
    deliverableId,
    committeeId,
    groupId,
    studentId,
    type: overrides.type || 'proposal',
    status: overrides.status || 'accepted',
    submittedAt: new Date(),
    storageRef: `gs://bucket/path/${deliverableId}`,
    sprintId: overrides.sprintId || generateUniqueId('sprint'),
    version: 1,
    validationHistory: [],
    feedback: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Fixture: Create a Review object
 * @param {Object} overrides
 * @returns {Object}
 */
function createReview(overrides = {}) {
  const reviewId = overrides.reviewId || generateUniqueId('rev');
  const deliverableId = overrides.deliverableId || generateUniqueId('del');
  const groupId = overrides.groupId || generateUniqueId('grp');
  const assignedMembers = overrides.assignedMembers || [
    {
      memberId: generateUniqueId('prof'),
      status: 'notified',
    },
  ];

  const deadlineDays = overrides.reviewDeadlineDays || 7;
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + deadlineDays);

  return {
    reviewId,
    deliverableId,
    groupId,
    status: 'pending',
    assignedMembers,
    deadline,
    instructions: overrides.instructions || 'Please review this deliverable.',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Fixture: Create a Comment object
 * @param {Object} overrides
 * @returns {Object}
 */
function createComment(overrides = {}) {
  const commentId = overrides.commentId || generateUniqueId('cmt');
  const deliverableId = overrides.deliverableId || generateUniqueId('del');
  const authorId = overrides.authorId || generateUniqueId('prof');
  const authorName = overrides.authorName || 'Prof Test';

  return {
    commentId,
    deliverableId,
    authorId,
    authorName,
    content: overrides.content || 'This is a test comment.',
    commentType: overrides.commentType || 'general',
    sectionNumber: overrides.sectionNumber || null,
    needsResponse: overrides.needsResponse || false,
    status: overrides.status || 'open',
    replies: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Fixture: Create a Reply object (for embedding in Comment)
 * @param {Object} overrides
 * @returns {Object}
 */
function createReply(overrides = {}) {
  const replyId = overrides.replyId || generateUniqueId('rpl');
  const authorId = overrides.authorId || generateUniqueId('stu');

  return {
    replyId,
    authorId,
    content: overrides.content || 'This is a reply.',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Helper: Create SprintRecord object for testing
 * @param {Object} overrides
 * @returns {Object}
 */
function createSprintRecord(overrides = {}) {
  const sprintRecordId = overrides.sprintRecordId || generateUniqueId('spr');
  const sprintId = overrides.sprintId || generateUniqueId('sprint');
  const groupId = overrides.groupId || generateUniqueId('grp');
  const committeeId = overrides.committeeId || generateUniqueId('cmt');

  return {
    sprintRecordId,
    sprintId,
    groupId,
    committeeId,
    committeeAssignedAt: new Date(),
    deliverableRefs: overrides.deliverableRefs || [],
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Helper: Create a complete test scenario with users, committee, group, deliverable
 * @param {Object} overrides
 * @returns {Promise<Object>}
 */
async function setupReviewScenario(overrides = {}) {
  const coordinator = createCoordinator({
    userId: overrides.coordinatorId || generateUniqueId('coord'),
  });

  const committeeMembers = [];
  const memberCount = overrides.memberCount || 3;
  for (let i = 0; i < memberCount; i++) {
    committeeMembers.push(
      createCommitteeMember({
        userId: generateUniqueId('prof'),
      })
    );
  }

  const committee = createCommittee({
    advisorIds: committeeMembers.map((m) => m.userId),
  });

  const group = createGroup({
    groupId: overrides.groupId || generateUniqueId('grp'),
    leaderId: overrides.studentId || generateUniqueId('stu'),
  });

  const deliverable = createDeliverable({
    deliverableId: overrides.deliverableId,
    committeeId: committee.committeeId,
    groupId: group.groupId,
    studentId: group.leaderId,
    status: overrides.deliverableStatus || 'accepted',
  });

  return {
    coordinator,
    committeeMembers,
    committee,
    group,
    deliverable,
  };
}

module.exports = {
  generateUniqueId,
  createUser,
  createCoordinator,
  createCommitteeMember,
  createGroup,
  createCommittee,
  createDeliverable,
  createReview,
  createComment,
  createReply,
  createSprintRecord,
  setupReviewScenario,
};
