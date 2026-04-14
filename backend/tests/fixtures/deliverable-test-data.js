'use strict';

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Test data fixtures for deliverable validation tests.
 * Provides factories and utilities for creating mock database objects
 * with consistent, predictable states.
 */

/**
 * Generate a unique ID for tests with prefix and timestamp
 * @param {string} prefix 
 * @returns {string}
 */
function generateUniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Define mock deliverable types
 */
const DELIVERABLE_TYPES = [
  'proposal',
  'statement_of_work',
  'demo',
  'interim_report',
  'final_report',
];

/**
 * Fixture: Create a valid User object
 * @param {Object} overrides
 * @returns {Object}
 */
function createUser(overrides = {}) {
  const userId = generateUniqueId('stu');
  return {
    userId,
    firstName: 'Test',
    lastName: 'Student',
    email: `${userId}@test.edu`,
    role: 'student',
    status: 'active',
    ...overrides,
  };
}

/**
 * Fixture: Create a valid Group object
 * @param {Object} overrides
 * @returns {Object}
 */
function createGroup(overrides = {}) {
  const groupId = generateUniqueId('grp');
  const leaderId = generateUniqueId('stu');

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
    advisorId: null,
    committeeId: null,
    ...overrides,
  };
}

/**
 * Fixture: Create a valid Committee object
 * @param {Object} overrides
 * @returns {Object}
 */
function createCommittee(overrides = {}) {
  const committeeId = generateUniqueId('cmt');
  const createdBy = generateUniqueId('coord');

  return {
    committeeId,
    committeeName: `Committee-${committeeId}`,
    createdBy,
    status: 'published',
    advisorIds: [generateUniqueId('adv')],
    juryIds: [generateUniqueId('jury')],
    ...overrides,
  };
}

/**
 * Fixture: Create a DeliverableStaging object
 * @param {Object} overrides
 * @returns {Object}
 */
function createDeliverableStaging(overrides = {}) {
  const stagingId = generateUniqueId('stg');
  const groupId = overrides.groupId || generateUniqueId('grp');
  const submittedBy = overrides.submittedBy || generateUniqueId('stu');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1 hour

  return {
    stagingId,
    groupId,
    deliverableType: 'proposal',
    sprintId: generateUniqueId('sprint'),
    submittedBy,
    description: 'Test deliverable',
    tempFilePath: '/tmp/test-file.pdf',
    fileSize: 1024 * 100, // 100KB
    fileHash: 'abc123def456',
    mimeType: 'application/pdf',
    status: 'staging',
    expiresAt,
    ...overrides,
  };
}

/**
 * Fixture: Create a valid SprintRecord object
 * @param {Object} overrides
 * @returns {Object}
 */
function createSprintRecord(overrides = {}) {
  const sprintRecordId = generateUniqueId('spr');
  const sprintId = generateUniqueId('sprint');
  const groupId = generateUniqueId('grp');
  const committeeId = generateUniqueId('cmt');

  return {
    sprintRecordId,
    sprintId,
    groupId,
    committeeId,
    committeeAssignedAt: new Date(),
    deliverableRefs: [],
    status: 'pending',
    ...overrides,
  };
}

/**
 * Fixture: Create a Group with multiple confirmed members
 * Useful for deadline validation tests that check member confirmation
 * @param {number} memberCount
 * @param {Object} overrides
 * @returns {Object}
 */
function createGroupWithMembers(memberCount = 3, overrides = {}) {
  const groupId = generateUniqueId('grp');
  const leaderId = generateUniqueId('stu');

  const members = [];
  
  // Add leader
  members.push({
    userId: leaderId,
    role: 'leader',
    status: 'accepted',
    joinedAt: new Date(),
  });

  // Add team members
  for (let i = 0; i < memberCount - 1; i++) {
    members.push({
      userId: generateUniqueId('stu'),
      role: 'member',
      status: 'accepted',
      joinedAt: new Date(),
    });
  }

  return {
    groupId,
    groupName: `Group-${groupId}`,
    leaderId,
    status: 'active',
    members,
    advisorId: null,
    committeeId: null,
    ...overrides,
  };
}

/**
 * Fixture: Create a Group with unconfirmed members
 * Useful for testing deadline validation failures
 * @param {Object} overrides
 * @returns {Object}
 */
function createGroupWithUnconfirmedMembers(overrides = {}) {
  const groupId = generateUniqueId('grp');
  const leaderId = generateUniqueId('stu');

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
      {
        userId: generateUniqueId('stu'),
        role: 'member',
        status: 'pending', // Not accepted
        joinedAt: null,
      },
    ],
    advisorId: null,
    committeeId: null,
    ...overrides,
  };
}

/**
 * Fixture: Create a Committee with validation failures
 * Useful for testing committee validation failures
 * @param {string} failureType - 'no_advisors' | 'no_jury' | 'conflict'
 * @param {Object} overrides
 * @returns {Object}
 */
function createInvalidCommittee(failureType = 'no_advisors', overrides = {}) {
  const committeeId = generateUniqueId('cmt');
  const createdBy = generateUniqueId('coord');

  let advisorIds = [generateUniqueId('adv')];
  let juryIds = [generateUniqueId('jury')];

  if (failureType === 'no_advisors') {
    advisorIds = [];
  } else if (failureType === 'no_jury') {
    juryIds = [];
  } else if (failureType === 'conflict') {
    // Same person in both roles
    const conflictId = generateUniqueId('person');
    advisorIds = [conflictId];
    juryIds = [conflictId];
  }

  return {
    committeeId,
    committeeName: `Committee-${committeeId}`,
    createdBy,
    status: 'published',
    advisorIds,
    juryIds,
    ...overrides,
  };
}

/**
 * Fixture: Create an AuditLog object
 * @param {Object} overrides
 * @returns {Object}
 */
function createAuditLog(overrides = {}) {
  return {
    action: 'TEST_ACTION',
    actorId: generateUniqueId('stu'),
    targetId: null,
    groupId: generateUniqueId('grp'),
    payload: {},
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Test)',
    ...overrides,
  };
}

/**
 * Test file utilities for validation tests
 */
const testFiles = {
  /**
   * Valid PDF magic bytes: %PDF
   */
  validPdfMagicBytes: Buffer.from([0x25, 0x50, 0x44, 0x46]),

  /**
   * Valid DOCX/ZIP magic bytes: PK\x03\x04
   */
  validDocxMagicBytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]),

  /**
   * Invalid magic bytes (spoofed PDF)
   */
  spoofedPdfMagicBytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), // JPEG header

  /**
   * Get size limits for deliverable types
   */
  sizeLimits: {
    proposal: 50,
    statement_of_work: 50,
    demo: 500,
    interim_report: 100,
    final_report: 500,
  },

  /**
   * Convert MB to bytes
   */
  mbToBytes: (mb) => mb * 1024 * 1024,

  /**
   * Create a file size that exceeds the limit for a type
   */
  createOversizedFileSize: (deliverableType) => {
    const limitMb = testFiles.sizeLimits[deliverableType] || 50;
    return testFiles.mbToBytes(limitMb + 1);
  },

  /**
   * Create a file size that is within limits
   */
  createValidFileSize: (deliverableType) => {
    const limitMb = testFiles.sizeLimits[deliverableType] || 50;
    return testFiles.mbToBytes(limitMb - 1);
  },
};

/**
 * Deadline test utilities
 */
const deadlineUtils = {
  /**
   * Create a deadline in the past (expired)
   */
  pastDeadline: () => new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago

  /**
   * Create a deadline in the future (not yet due)
   */
  futureDeadline: () => new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now

  /**
   * Create a deadline just now
   */
  nowDeadline: () => new Date(Date.now()),
};

/**
 * Create a test file on disk with specified magic bytes and size
 * Used for validateFormat() tests to verify magic byte detection
 * 
 * @param {Buffer} magicBytes - The magic bytes to write to the file
 * @param {number} totalSize - Total size of the file in bytes
 * @param {string} extension - File extension ('pdf', 'docx', 'zip', etc)
 * @returns {string} - Absolute path to the created file
 */
function createTestFile(magicBytes, totalSize, extension = 'pdf') {
  const tmpDir = path.join(os.tmpdir(), 'jest-tests');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const fileName = `test-file-${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
  const filePath = path.join(tmpDir, fileName);

  // Create buffer with magic bytes + padding
  const buffer = Buffer.alloc(totalSize);
  
  // Write magic bytes at the start
  if (magicBytes && Buffer.isBuffer(magicBytes)) {
    magicBytes.copy(buffer, 0);
  }

  // Write to disk
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

module.exports = {
  generateUniqueId,
  DELIVERABLE_TYPES,
  createUser,
  createGroup,
  createCommittee,
  createDeliverableStaging,
  createSprintRecord,
  createGroupWithMembers,
  createGroupWithUnconfirmedMembers,
  createInvalidCommittee,
  createAuditLog,
  testFiles,
  deadlineUtils,
  createTestFile,
};
