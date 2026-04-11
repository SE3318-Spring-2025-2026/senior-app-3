/**
 * Centralized list of schedule operation types for the Senior Project Management System.
 *
 * Each operation type determines a specific boundary for student/professor actions
 * (e.g. group formation, member invites, advisor association).
 */

const OPERATION_TYPES = {
  GROUP_CREATION: 'group_creation',
  MEMBER_ADDITION: 'member_addition',
  ADVISOR_ASSOCIATION: 'advisor_association',
};

// Also export as an array/set for validation/enum purposes
const VALID_OPERATION_TYPES = Object.values(OPERATION_TYPES);

module.exports = {
  ...OPERATION_TYPES,
  VALID_OPERATION_TYPES,
};
