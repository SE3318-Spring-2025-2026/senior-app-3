const User = require('../models/User');
const Committee = require('../models/Committee');

/**
 * Validate that all advisor IDs exist and have professor/admin role
 *
 * @param {string[]} advisorIds - Array of user IDs to validate
 * @returns {object} { valid: boolean, errors: [{advisorId, reason}] }
 */
const validateAdvisors = async (advisorIds) => {
  const errors = [];

  if (!Array.isArray(advisorIds) || advisorIds.length === 0) {
    return {
      valid: false,
      errors: [{ reason: 'advisorIds must be a non-empty array' }],
    };
  }

  // Remove duplicates
  const uniqueAdvisorIds = [...new Set(advisorIds)];

  if (uniqueAdvisorIds.length !== advisorIds.length) {
    return {
      valid: false,
      errors: [{ reason: 'Advisor list contains duplicate IDs' }],
    };
  }

  for (const advisorId of advisorIds) {
    const advisor = await User.findOne({ userId: advisorId });

    if (!advisor) {
      errors.push({
        advisorId,
        reason: 'Advisor not found',
      });
      continue;
    }

    if (!['professor', 'admin'].includes(advisor.role)) {
      errors.push({
        advisorId,
        reason: `User ${advisorId} has role '${advisor.role}', not professor or admin`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Check for advisor assignment conflicts
 * An advisor is in conflict if already assigned to another committee in same status
 *
 * @param {string[]} advisorIds - Array of advisor IDs to check
 * @param {string} committeeId - Current committee ID (to exclude from conflict check)
 * @returns {object} { hasConflict: boolean, conflicts: [{advisorId, conflictingCommitteeId}] }
 */
const checkAdvisorConflicts = async (advisorIds, committeeId) => {
  const conflicts = [];

  // For Phase 1: Simple check — advisor already assigned to another active committee
  // Can be refined in Phase 2 if term/cycle constraints are added to schema
  for (const advisorId of advisorIds) {
    const existingAssignment = await Committee.findOne({
      committeeId: { $ne: committeeId },
      advisorIds: { $in: [advisorId] },
      status: { $in: ['draft', 'validated', 'published'] },
    });

    if (existingAssignment) {
      conflicts.push({
        advisorId,
        conflictingCommitteeId: existingAssignment.committeeId,
      });
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  };
};

/**
 * Check that assigned advisors and jury members don't overlap
 *
 * @param {string[]} advisorIds - Array of advisor IDs
 * @param {string[]} juryIds - Array of jury member IDs
 * @returns {object} { valid: boolean, errors: [] }
 */
const checkAdvisorJuryOverlap = (advisorIds, juryIds) => {
  const advisorSet = new Set(advisorIds);
  const overlaps = juryIds.filter((juryId) => advisorSet.has(juryId));

  if (overlaps.length > 0) {
    return {
      valid: false,
      errors: [
        {
          reason: `${overlaps.length} person(s) assigned as both advisor and jury member`,
          overlappingIds: overlaps,
        },
      ],
    };
  }

  return {
    valid: true,
    errors: [],
  };
};

module.exports = {
  validateAdvisors,
  checkAdvisorConflicts,
  checkAdvisorJuryOverlap,
};
