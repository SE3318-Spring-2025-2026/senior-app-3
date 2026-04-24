/**
 * ================================================================================
 * ISSUE #253: Final Grade Approval Controller
 * ================================================================================
 *
 * Purpose:
 * HTTP request handler for coordinator approval endpoint.
 * Responsible for:
 * 1. Role-based access control (coordinator-only)
 * 2. Request validation (coordinatorId, decision, overrides)
 * 3. Calling approval service
 * 4. Error handling and status codes
 * 5. Response formatting for frontend (Issue #252)
 *
 * Process Context:
 * - Input: POST request from Issue #252 (UI submission)
 * - Middleware: authMiddleware (verify JWT), roleMiddleware (coordinator only)
 * - Service call: approvalService.approveGroupGrades()
 * - Output: FinalGradeApproval JSON response
 * - Status codes: 200 (success), 403 (forbidden), 404 (not found), 409 (conflict), 422 (validation)
 *
 * ================================================================================
 */

const { approveGroupGrades, GradeApprovalError } = require('../services/approvalService');

/**
 * ISSUE #253: POST /groups/:groupId/final-grades/approval
 * 
 * Handler for coordinator grade approval endpoint.
 * Receives approval decision and optional overrides from UI (Issue #252),
 * persists approval state to D7, and returns confirmation for Issue #255 consumption.
 *
 * Request body (from Issue #252):
 * {
 *   coordinatorId: String,           // Who is approving?
 *   decision: "approve" | "reject",  // Approval decision
 *   overrideEntries: [               // Optional per-student grade adjustments
 *     {
 *       studentId: String,
 *       originalFinalGrade: Number,
 *       overriddenFinalGrade: Number,
 *       comment?: String
 *     }
 *   ],
 *   reason?: String                  // Optional justification
 * }
 *
 * Response (for Issue #255 & UI feedback):
 * {
 *   success: Boolean,
 *   approvalId: String,
 *   timestamp: Date,
 *   groupId: String,
 *   coordinatorId: String,
 *   decision: String,
 *   totalStudents: Number,
 *   approvedCount: Number,
 *   rejectedCount: Number,
 *   overridesApplied: Number,
 *   grades: [
 *     {
 *       studentId: String,
 *       computedFinalGrade: Number,
 *       effectiveFinalGrade: Number,
 *       overrideApplied: Boolean,
 *       overriddenGrade: Number | null,
 *       approvedAt: Date,
 *       approvedBy: String
 *     }
 *   ],
 *   message: String
 * }
 *
 * Error responses:
 * - 403: Forbidden (user is not coordinator)
 * - 404: Not found (group doesn't exist)
 * - 409: Conflict (grades already approved)
 * - 422: Unprocessable entity (validation error)
 * - 500: Internal server error
 */
const approveGroupGradesHandler = async (req, res) => {
  try {
    // ========================================================================
    // ISSUE #253: EXTRACT AND VALIDATE REQUEST
    // ========================================================================

    const { groupId } = req.params;
    const { coordinatorId, decision, overrideEntries, reason } = req.body;

    // ISSUE #253: Validate groupId parameter
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        error: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    // ISSUE #253: Validate coordinatorId (must match authenticated user)
    if (!coordinatorId) {
      return res.status(422).json({
        error: 'coordinatorId is required',
        code: 'MISSING_COORDINATOR_ID'
      });
    }

    // ISSUE #253: Strict Authorization Check (Security Fix)
    // Prevent Audit Log Forgery by ensuring the user is acting as themselves
    if (coordinatorId !== req.user.userId) {
      return res.status(403).json({
        error: 'Forbidden: You can only approve grades using your own coordinator ID',
        code: 'FORBIDDEN_ACTOR_MISMATCH'
      });
    }

    // ISSUE #253: Validate decision field
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(422).json({
        error: 'decision must be "approve" or "reject"',
        code: 'INVALID_DECISION'
      });
    }

    // ISSUE #253: Log approval attempt for audit trail
    console.log(
      `[Issue #253] Approval attempt - Group: ${groupId}, Coordinator: ${coordinatorId}, Decision: ${decision}`
    );

    // ========================================================================
    // ISSUE #253: CALL APPROVAL SERVICE (ATOMIC TRANSACTION)
    // ========================================================================

    let approvalResult;
    try {
      approvalResult = await approveGroupGrades(
        groupId,
        coordinatorId,
        decision,
        overrideEntries || [],
        reason || null
      );
    } catch (error) {
      // ISSUE #253: Handle GradeApprovalError with proper status codes
      if (error instanceof GradeApprovalError) {
        console.warn(`[Issue #253] Approval failed - ${error.message}`);

        // ISSUE #253: Return appropriate status code based on error type
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.errorCode,
          timestamp: new Date()
        });
      }

      // ISSUE #253: Unexpected error
      throw error;
    }

    // ========================================================================
    // ISSUE #253: RETURN SUCCESS RESPONSE
    // ========================================================================

    console.log(
      `[Issue #253] Approval successful - Group: ${groupId}, Decision: ${decision}`
    );

    // ISSUE #253: Return 200 with full approval response for Issue #255 & UI
    return res.status(200).json(approvalResult);
  } catch (error) {
    // ISSUE #253: Log unexpected errors
    console.error(
      '[Issue #253] Unexpected error in approveGroupGradesHandler',
      error
    );

    // ISSUE #253: Return 500 for unexpected errors
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * ISSUE #253: GET /groups/:groupId/final-grades/summary
 * 
 * Optional: Get approval summary for coordinator dashboard
 * Shows counts of grades by status (pending, approved, rejected, published)
 *
 * Response:
 * [
 *   {
 *     _id: "pending",
 *     count: 5,
 *     avgGrade: 78.5
 *   },
 *   {
 *     _id: "approved",
 *     count: 3,
 *     avgGrade: 82.0
 *   }
 * ]
 */
const getGroupApprovalSummaryHandler = async (req, res) => {
  try {
    const { groupId } = req.params;

    // ISSUE #253: Validate groupId
    if (!groupId || typeof groupId !== 'string' || groupId.trim() === '') {
      return res.status(400).json({
        error: 'Invalid group ID',
        code: 'INVALID_GROUP_ID'
      });
    }

    // ISSUE #253: Import service here to avoid circular dependency
    const { getGroupApprovalSummary } = require('../services/approvalService');

    // ISSUE #253: Fetch summary
    const summary = await getGroupApprovalSummary(groupId);

    console.log(`[Issue #253] Summary retrieved for group: ${groupId}`);

    // ISSUE #253: Return summary
    return res.status(200).json({
      groupId,
      summary,
      timestamp: new Date()
    });
  } catch (error) {
    console.error(
      '[Issue #253] Error in getGroupApprovalSummaryHandler',
      error
    );

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date()
    });
  }
};

/**
 * ================================================================================
 * ISSUE #253: EXPORTS
 * ================================================================================
 */

module.exports = {
  approveGroupGradesHandler,
  getGroupApprovalSummaryHandler
};
