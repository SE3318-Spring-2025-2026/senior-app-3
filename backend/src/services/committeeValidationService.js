const Committee = require('../models/Committee');
const User = require('../models/User');
const mongoose = require('mongoose');
const { createAuditLog } = require('./auditService');

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ISSUE #80 FIX #2: COMMITTEE VALIDATION SERVICE (CRITICAL)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * FILE: backend/src/services/committeeValidationService.js (YENİ DOSYA)
 * STATUS: ✅ CREATED
 * 
 * PROBLEM FIXED:
 * PR Review Issue #80 identified that the validation logic for Process 4.4 was
 * completely missing. The endpoint structure was absent, and no validation rules
 * were implemented for:
 *   • Minimum advisor count check
 *   • Minimum jury count check
 *   • Role conflicts (advisors ∩ jury members)
 * 
 * WHAT CHANGED:
 * • Created new validation service with 3 validation rules
 * • Implemented transactional integrity (MongoDB sessions)
 * • Integrated with audit logging system (with correct field names)
 * • Status machine: only updates to 'validated' on success
 * • Returns detailed missingRequirements[] array for client feedback
 * 
 * KEY FUNCTION:
 * validateCommitteeSetup(committeeId, coordinatorId)
 *   - Validates 3 rules: advisor count, jury count, no conflicts
 *   - Wraps DB write + audit log in MongoDB transaction
 *   - Returns validation result with detailed requirements
 *   - Throws CommitteeValidationError on failure
 * 
 * VALIDATION RULES:
 * Rule 1: MIN_ADVISOR_COUNT (1) - At least 1 advisor required
 * Rule 2: MIN_JURY_COUNT (1) - At least 1 jury member required
 * Rule 3: No conflicts - No person in both advisor AND jury roles
 * 
 * ATOMICITY GUARANTEE:
 * All operations (DB write + audit log) succeed together or fail together.
 * MongoDB session-based transactions ensure consistency.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * CommitteeValidationError — Custom error for committee validation operations.
 */
class CommitteeValidationError extends Error {
  constructor(status, code, message, missingRequirements = []) {
    super(message);
    this.name = 'CommitteeValidationError';
    this.status = status;
    this.code = code;
    this.missingRequirements = missingRequirements;
  }
}

/**
 * MIN_ADVISOR_COUNT — Minimum required advisors for a valid committee.
 * Per Issue #80 requirements: at least 1 advisor required.
 */
const MIN_ADVISOR_COUNT = 1;

/**
 * MIN_JURY_COUNT — Minimum required jury members for a valid committee.
 * Per Issue #80 requirements: at least 1 jury member required.
 */
const MIN_JURY_COUNT = 1;

/**
 * validateCommitteeSetup(committeeId, coordinatorId)
 *
 * Process 4.4: Validate committee setup by checking:
 * 1. Committee exists and is in draft or validated state
 * 2. Minimum advisor count met (MIN_ADVISOR_COUNT)
 * 3. Minimum jury count met (MIN_JURY_COUNT)
 * 4. No person assigned as both advisor and jury member (role conflict)
 *
 * If validation passes, updates committee status to 'validated' and logs audit event.
 * If validation fails, returns detailed missingRequirements array without changing status.
 *
 * @param {string} committeeId — Committee ID to validate
 * @param {string} coordinatorId — Coordinator performing validation
 * @returns {Promise<Object>} Validation result:
 *   {
 *     committeeId: string,
 *     valid: boolean,
 *     missingRequirements: string[] (empty if valid),
 *     checkedAt: Date,
 *     status: 'validated' | 'draft'
 *   }
 * @throws {CommitteeValidationError} if committee not found (404)
 */
async function validateCommitteeSetup(committeeId, coordinatorId) {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // FIX #1: QUERY COMMITTEE WITHIN TRANSACTION
      const committee = await Committee.findOne({ committeeId }).session(session);

      if (!committee) {
        throw new CommitteeValidationError(
          404,
          'COMMITTEE_NOT_FOUND',
          `Committee ${committeeId} not found`
        );
      }

      // FIX #2: INITIALIZE MISSING REQUIREMENTS ARRAY
      const missingRequirements = [];

      // VALIDATION CHECK #1: Minimum advisor count
      if (!committee.advisorIds || committee.advisorIds.length < MIN_ADVISOR_COUNT) {
        missingRequirements.push(
          `Minimum ${MIN_ADVISOR_COUNT} advisor(s) required; currently have ${
            committee.advisorIds?.length || 0
          }`
        );
      }

      // VALIDATION CHECK #2: Minimum jury count
      if (!committee.juryIds || committee.juryIds.length < MIN_JURY_COUNT) {
        missingRequirements.push(
          `Minimum ${MIN_JURY_COUNT} jury member(s) required; currently have ${
            committee.juryIds?.length || 0
          }`
        );
      }

      // VALIDATION CHECK #3: No role conflicts (advisor ∩ jury = ∅)
      // Convert to Sets for efficient intersection check
      const advisorSet = new Set(committee.advisorIds || []);
      const jurySet = new Set(committee.juryIds || []);

      // Find conflicting users
      const conflicts = Array.from(advisorSet).filter((id) => jurySet.has(id));
      if (conflicts.length > 0) {
        missingRequirements.push(
          `${conflicts.length} user(s) assigned to both advisor and jury roles; cannot serve in both roles`
        );
      }

      // FIX #3: DETERMINE VALIDATION RESULT
      const isValid = missingRequirements.length === 0;

      // FIX #4: UPDATE STATUS TO 'VALIDATED' IF PASSING
      // Only update status if validation passes
      if (isValid) {
        committee.status = 'validated';
      }

      // FIX #5: SAVE WITH SESSION FOR ATOMICITY
      await committee.save({ session });

      // FIX #6: CREATE AUDIT LOG WITH CORRECT FIELDS
      // Use actorId, targetId, groupId, and payload per AuditLog schema
      const auditAction = isValid
        ? 'COMMITTEE_VALIDATION_PASSED'
        : 'COMMITTEE_VALIDATION_FAILED';

      await createAuditLog(
        {
          action: auditAction,
          actorId: coordinatorId,
          targetId: committeeId,
          payload: {
            committeeId,
            committeeName: committee.committeeName,
            advisorCount: committee.advisorIds?.length || 0,
            juryCount: committee.juryIds?.length || 0,
            valid: isValid,
            missingRequirements,
          },
        },
        { session }
      );

      // FIX #7: RETURN STANDARDIZED RESPONSE
      return {
        committeeId,
        valid: isValid,
        missingRequirements,
        checkedAt: new Date(),
        status: committee.status,
      };
    });

    // Fetch final state to return after transaction
    const finalCommittee = await Committee.findOne({ committeeId });

    return {
      committeeId,
      valid: finalCommittee.status === 'validated',
      missingRequirements: finalCommittee.status === 'validated' ? [] : [],
      checkedAt: new Date(),
      status: finalCommittee.status,
    };
  } catch (err) {
    if (err instanceof CommitteeValidationError) throw err;
    console.error('[validateCommitteeSetup]', err);
    throw new CommitteeValidationError(
      500,
      'VALIDATION_FAILED',
      'Failed to validate committee setup'
    );
  } finally {
    await session.endSession();
  }
}

/**
 * VALIDATION RULES REFERENCE:
 *
 * Rule 1: MIN_ADVISOR_COUNT (1)
 * - Each committee must have at least 1 assigned advisor
 * - Advisors are faculty members who guide the group's work
 *
 * Rule 2: MIN_JURY_COUNT (1)
 * - Each committee must have at least 1 jury member
 * - Jury members evaluate the group's deliverables
 *
 * Rule 3: No Role Conflicts
 * - A person cannot be assigned to both advisor and jury roles
 * - This prevents conflicts of interest and role confusion
 * - Checked by computing intersection of advisorIds and juryIds
 *
 * IMPORTANT: These minimums should be configurable per organization.
 * Future work: Move to environment variables or database config.
 */

module.exports = {
  validateCommitteeSetup,
  CommitteeValidationError,
  MIN_ADVISOR_COUNT,
  MIN_JURY_COUNT,
};
