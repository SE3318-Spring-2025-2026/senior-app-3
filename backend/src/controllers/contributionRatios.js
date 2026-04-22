/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ISSUE #236 CONTROLLER: contributionRatios.js
 * HTTP Endpoint Handler for Process 7.4 Ratio Calculation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * Express controller handling REST API requests for ratio recalculation.
 * Bridges HTTP layer (Express) to service layer (contributionRatioService).
 *
 * Endpoint:
 * POST /api/groups/:groupId/sprints/:sprintId/contributions/recalculate
 *
 * Responsibilities:
 * 1. Extract + validate path parameters (groupId, sprintId)
 * 2. Authenticate + authorize (coordinator role check)
 * 3. Call service layer (recalculateSprintRatios)
 * 4. Handle error responses (404, 403, 409, 422, 500)
 * 5. Dispatch audit log (non-blocking)
 * 6. Return success response with ratios + metadata
 *
 * Error Handling:
 * - 400: Invalid input (malformed request body)
 * - 403: Not authorized (not coordinator)
 * - 404: Resource not found (group/sprint)
 * - 409: Conflict (sprint locked)
 * - 422: Invalid state (zero group total, no members)
 * - 500: Server error (calculation/DB failure)
 *
 * DFD Context:
 * - Maps to Process 7.4 entry point (f7_p74_entry HTTP handler)
 * - Receives input from HTTP client (frontend)
 * - Calls contributionRatioService (coordinates 10-step calculation)
 * - Returns SprintContributionSummary to client
 */

const express = require('express');
const {
  recalculateSprintRatios,
  RatioServiceError
} = require('../services/contributionRatioService');
const { auditLog } = require('../services/auditService');
const { notificationService } = require('../services/notificationService');

/**
 * ISSUE #236 CONTROLLER: recalculateContributionRatios
 * Express endpoint handler for POST ratio recalculation request
 *
 * @param {express.Request} req - HTTP request object
 *   - req.params.groupId: Group MongoDB ObjectId
 *   - req.params.sprintId: Sprint MongoDB ObjectId
 *   - req.user: Authenticated user object {id, email, roles}
 *
 * @param {express.Response} res - HTTP response object
 *
 * @returns {void} - Sends JSON response with status code
 *
 * Response Formats:
 *
 * Success (200):
 * {
 *   success: true,
 *   data: {
 *     groupId: "...",
 *     sprintId: "...",
 *     groupTotalStoryPoints: 42,
 *     recalculatedAt: "2024-01-15T10:30:00Z",
 *     strategy: "fixed",
 *     contributions: [
 *       { studentId, contributionRatio, targetStoryPoints, ... }
 *     ],
 *     summary: { totalMembers, averageRatio, maxRatio, minRatio }
 *   }
 * }
 *
 * Error (4xx/5xx):
 * {
 *   success: false,
 *   error: {
 *     status: 409,
 *     code: "SPRINT_LOCKED",
 *     message: "Cannot recalculate ratios for locked sprint..."
 *   }
 * }
 *
 * Workflow:
 * 1. Extract path params
 * 2. Validate user authenticated (middleware ensures this)
 * 3. Call service layer
 * 4. On error: return appropriate HTTP status + error details
 * 5. On success: audit log (async), send response
 */
async function recalculateContributionRatios(req, res) {
  // ISSUE #236 CONTROLLER: recalculateContributionRatios
  // Why: REST API entry point for ratio recalculation
  // What: Handler for POST /groups/:groupId/sprints/:sprintId/contributions/recalculate

  const { groupId, sprintId } = req.params;
  const userId = req.user.id;  // Extracted by auth middleware

  try {
    // ISSUE #236 STEP 0: Input validation
    // Why: Ensure parameters are properly formed
    // What: Check groupId and sprintId are provided and non-empty
    if (!groupId || !sprintId) {
      return res.status(400).json({
        success: false,
        error: {
          status: 400,
          code: 'INVALID_INPUT',
          message: 'groupId and sprintId are required path parameters'
        }
      });
    }

    // ISSUE #236: Log request start
    // Why: Audit trail for ratio recalculation requests
    // What: Record who initiated the request
    console.info('[contributionRatios.recalculateContributionRatios] Request received', {
      groupId,
      sprintId,
      userId,
      timestamp: new Date()
    });

    // ISSUE #236 MAIN CALL: Invoke service layer (Process 7.4 orchestrator)
    // Why: Delegate business logic to service
    // What: Call recalculateSprintRatios with group/sprint/user IDs
    // Returns: SprintContributionSummary with all calculated ratios
    const summary = await recalculateSprintRatios(groupId, sprintId, userId);

    // ISSUE #236: SUCCESS PATH - Ratio calculation completed
    // Why: All 10 steps executed successfully
    // What: Return 200 with detailed summary

    // ISSUE #236: AUDIT LOGGING (non-blocking)
    // Why: Record successful recalculation for compliance
    // What: Dispatch async audit entry
    // Design: Use .catch() to prevent audit failure from crashing request
    // Note: Audits happen AFTER response sent (fire-and-forget pattern)
    setImmediate(async () => {
      try {
        await auditLog({
          action: 'RATIO_RECALCULATION_COMPLETED',
          entity: {
            type: 'Sprint',
            id: sprintId,
            groupId: groupId
          },
          actor: userId,
          details: {
            totalMembers: summary.summary.totalMembers,
            groupTotal: summary.groupTotalStoryPoints,
            averageRatio: summary.summary.averageRatio,
            strategy: summary.strategy
          },
          timestamp: new Date()
        });
      } catch (auditErr) {
        // ISSUE #236: Audit failure should not crash request
        // Why: Audit is important but not critical to user request
        console.error('[contributionRatios] Audit logging failed', auditErr.message);
      }
    });

    // ISSUE #236: NOTIFICATION DISPATCH (non-blocking)
    // Why: Notify stakeholders of ratio update
    // What: Async notification to group coordinator/committee
    setImmediate(async () => {
      try {
        await notificationService.notifyRatioRecalculation({
          groupId,
          sprintId,
          summary
        });
      } catch (notifErr) {
        console.error('[contributionRatios] Notification dispatch failed', notifErr.message);
      }
    });

    // ISSUE #236: Send successful response
    // Why: Client needs detailed ratio breakdown for display
    // Status: 200 OK (successful calculation)
    return res.status(200).json({
      success: true,
      data: summary
    });

  } catch (error) {
    // ISSUE #236 ERROR PATH: Catch service layer errors
    // Why: Convert service errors to HTTP responses
    // What: Extract status code and error details from RatioServiceError

    // ISSUE #236: Check if error is RatioServiceError (service layer)
    // Why: Service errors have custom status codes
    // What: Use error.status and error.code directly
    if (error instanceof RatioServiceError) {
      // ISSUE #236: Log error for debugging
      console.warn('[contributionRatios.recalculateContributionRatios] Service error', {
        code: error.code,
        status: error.status,
        message: error.message,
        groupId,
        sprintId,
        userId,
        timestamp: new Date()
      });

      // ISSUE #236: AUDIT LOGGING FOR ERRORS
      // Why: Record failed recalculation attempts
      // What: Log error reason and requestor
      setImmediate(async () => {
        try {
          await auditLog({
            action: 'RATIO_RECALCULATION_FAILED',
            entity: {
              type: 'Sprint',
              id: sprintId,
              groupId: groupId
            },
            actor: userId,
            error: {
              code: error.code,
              message: error.message
            },
            timestamp: new Date()
          });
        } catch (auditErr) {
          console.error('[contributionRatios] Error audit logging failed', auditErr.message);
        }
      });

      // ISSUE #236: Return error response with HTTP status
      // Why: Client needs to understand what went wrong
      // Status codes:
      // - 404: Resource not found (group/sprint doesn't exist)
      // - 403: Unauthorized (not coordinator)
      // - 409: Conflict (sprint locked, past deadline)
      // - 422: Invalid state (no members, zero group total)
      // - 500: Server error (calculation/DB failure)
      return res.status(error.status).json({
        success: false,
        error: {
          status: error.status,
          code: error.code,
          message: error.message,
          timestamp: error.timestamp
        }
      });
    }

    // ISSUE #236: Handle unknown errors (not RatioServiceError)
    // Why: Catch unexpected errors from dependencies
    // What: Log and return 500 generic error
    console.error('[contributionRatios.recalculateContributionRatios] Unexpected error', {
      error: error.message,
      stack: error.stack,
      groupId,
      sprintId,
      userId
    });

    // ISSUE #236: Return generic 500 error
    // Why: Don't leak internal error details to client
    return res.status(500).json({
      success: false,
      error: {
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to recalculate ratios. Please try again later.'
      }
    });
  }
}

/**
 * ISSUE #236 CONTROLLER HELPER: validateCoordinatorRole
 * Express middleware to verify user is group coordinator
 *
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {Function} next - Call to proceed to next middleware
 *
 * @returns {void}
 *
 * Purpose: Guard endpoint so only coordinators can recalculate ratios
 * Design: Checks GroupMembership for coordinator role
 * On Fail: Returns 403 Forbidden (not executed by main handler)
 *
 * Note: This is a PRE-CHECK. The service also validates this (defense-in-depth).
 */
async function validateCoordinatorRole(req, res, next) {
  // ISSUE #236: Pre-check middleware
  // Why: Fast-fail if not coordinator (before service call)
  // What: Query GroupMembership to verify role
  // Design: Defense-in-depth (service also checks)

  const { groupId } = req.params;
  const userId = req.user.id;

  try {
    const GroupMembership = require('../models/GroupMembership');

    const membership = await GroupMembership.findOne({
      groupId: groupId,
      userId: userId,
      role: 'coordinator'
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        error: {
          status: 403,
          code: 'UNAUTHORIZED',
          message: 'You must be a group coordinator to recalculate ratios'
        }
      });
    }

    next();

  } catch (err) {
    console.error('[contributionRatios.validateCoordinatorRole] Error checking role', err);
    return res.status(500).json({
      success: false,
      error: {
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to verify coordinator role'
      }
    });
  }
}

/**
 * ISSUE #236 CONTROLLER HELPER: healthCheck
 * Optional endpoint to verify service is running
 *
 * @param {express.Request} req
 * @param {express.Response} res
 *
 * Returns: 200 with service status
 *
 * Purpose: Used by monitoring/load balancer to verify service health
 * Design: Minimal checks - just confirms service loaded
 */
function healthCheck(req, res) {
  // ISSUE #236: Health check endpoint
  // Why: Monitoring and load balancer checks
  // What: Verify service is loaded and running
  return res.status(200).json({
    success: true,
    service: 'contributionRatios',
    status: 'healthy',
    timestamp: new Date()
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS: Public API
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  recalculateContributionRatios,  // Main endpoint handler
  validateCoordinatorRole,        // Pre-check middleware
  healthCheck                      // Health monitoring endpoint
};
