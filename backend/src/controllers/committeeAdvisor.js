const Committee = require('../models/Committee');
const { createAuditLog } = require('../services/auditService');
const {
  validateAdvisors,
  checkAdvisorConflicts,
  checkAdvisorJuryOverlap,
} = require('../services/advisorAssignmentService');
const { forwardAssignmentsTo4_4 } = require('../services/committeeFwdService');
const SyncErrorLog = require('../models/SyncErrorLog');

/**
 * POST /committees/:committeeId/advisors
 *
 * Process 4.2 — Coordinator assigns advisors to a committee draft
 *
 * DFD flows:
 *   f02 (4.1 → 4.2) — Committee draft received as input
 *   f03 (4.2 → 4.4) — Advisor assignments forwarded to validation process
 *
 * Business rules:
 *   - Only coordinator can assign advisors
 *   - All advisor IDs must exist and have professor/admin role
 *   - No advisor can be assigned to multiple committees concurrently
 *   - Committee must exist and be in draft or validated status
 *   - Advisors must not overlap with jury members (checked by Issue #74)
 *
 * Acceptance Criteria:
 *   ✅ Coordinator can assign one or more advisors to a committee draft
 *   ✅ Non-coordinator callers receive 403 Forbidden
 *   ✅ Committee not found returns 404
 *   ✅ Invalid or non-existent advisorId in the list returns 400
 *   ✅ Advisor assignment conflict returns 409
 *   ✅ Updated committee object is returned with the full advisorIds[] list
 *   ✅ Advisor assignments are forwarded to process 4.4
 */
const assignAdvisorsToCmte = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const { advisorIds } = req.body;
    const coordinatorId = req.user.userId;

    // --- Validate input ---
    if (!Array.isArray(advisorIds)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'advisorIds must be an array',
      });
    }

    if (advisorIds.length === 0) {
      return res.status(400).json({
        code: 'EMPTY_ADVISOR_LIST',
        message: 'At least one advisor must be assigned',
      });
    }

    // --- Find committee ---
    const committee = await Committee.findOne({ committeeId });
    if (!committee) {
      return res.status(404).json({
        code: 'COMMITTEE_NOT_FOUND',
        message: `Committee ${committeeId} not found`,
      });
    }

    // --- Check committee status ---
    if (!['draft', 'validated'].includes(committee.status)) {
      return res.status(400).json({
        code: 'INVALID_COMMITTEE_STATUS',
        message: `Cannot assign advisors to committee in '${committee.status}' status. Only draft or validated committees can receive advisor assignments`,
        current_status: committee.status,
      });
    }

    // --- Validate all advisors exist and have correct role ---
    const validationResult = await validateAdvisors(advisorIds);
    if (!validationResult.valid) {
      return res.status(400).json({
        code: 'INVALID_ADVISORS',
        message: 'One or more advisor IDs are invalid',
        errors: validationResult.errors,
      });
    }

    // --- Check for conflicts (advisor already assigned to another committee) ---
    const conflictResult = await checkAdvisorConflicts(advisorIds, committeeId);
    if (conflictResult.hasConflict) {
      return res.status(409).json({
        code: 'ADVISOR_CONFLICT',
        message: 'One or more advisors are already assigned to another committee',
        conflicts: conflictResult.conflicts,
      });
    }

    // --- Check for advisor-jury overlap (if jury already assigned) ---
    if (committee.juryIds && committee.juryIds.length > 0) {
      const overlapResult = checkAdvisorJuryOverlap(advisorIds, committee.juryIds);
      if (!overlapResult.valid) {
        return res.status(400).json({
          code: 'ADVISOR_JURY_OVERLAP',
          message: 'One or more persons are already assigned as jury members',
          details: overlapResult.errors,
        });
      }
    }

    // --- Store old advisor list for audit ---
    const oldAdvisorIds = committee.advisorIds ? [...committee.advisorIds] : [];

    // --- Update committee with new advisors ---
    committee.advisorIds = advisorIds;
    committee.updatedAt = new Date();
    const updatedCommittee = await committee.save();

    // --- Create audit log ---
    try {
      await createAuditLog({
        action: 'COMMITTEE_ADVISORS_ASSIGNED',
        actorId: coordinatorId,
        targetId: committeeId,
        groupId: null, // Not a group operation
        payload: {
          committeeId,
          committeeName: committee.committeeName,
          advisorIds,
          oldAdvisorIds,
          count: advisorIds.length,
        },
        details: `Assigned ${advisorIds.length} advisor(s) to committee ${committee.committeeName}`,
      });
    } catch (auditError) {
      // Log but don't fail the operation
      console.error('Audit log creation failed:', auditError.message);
      await SyncErrorLog.create({
        service: 'committeAdvisor',
        operation: 'assignAdvisorsToCmte_audit',
        committeeId,
        lastError: auditError.message,
      });
    }

    // --- Forward to process 4.4 (Validation) ---
    try {
      await forwardAssignmentsTo4_4(committeeId, advisorIds, coordinatorId);
    } catch (forwardError) {
      // Log but don't fail the operation - assignment is already persisted
      console.error('Forward to 4.4 failed:', forwardError.message);
      await SyncErrorLog.create({
        service: 'committeAdvisor',
        operation: 'assignAdvisorsToCmte_forward',
        committeeId,
        lastError: forwardError.message,
      });
    }

    // --- Return success response ---
    return res.status(200).json({
      success: true,
      message: `Successfully assigned ${advisorIds.length} advisor(s) to committee`,
      committee: {
        committeeId: updatedCommittee.committeeId,
        committeeName: updatedCommittee.committeeName,
        description: updatedCommittee.description,
        advisorIds: updatedCommittee.advisorIds,
        juryIds: updatedCommittee.juryIds,
        status: updatedCommittee.status,
        createdAt: updatedCommittee.createdAt,
        updatedAt: updatedCommittee.updatedAt,
      },
      forwarded: true,
      forwardTarget: 'Process 4.4 — Committee Setup Validation',
    });
  } catch (error) {
    console.error('Error assigning advisors to committee:', error);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Failed to assign advisors to committee',
      error: error.message,
    });
  }
};

module.exports = {
  assignAdvisorsToCmte,
};
