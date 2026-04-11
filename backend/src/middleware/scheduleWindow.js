const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * checkScheduleWindow(operationType, options)
 *
 * Issue #61 Resolution: Schedule Window Enforcement Middleware
 * * This middleware addresses PR Review Issue #7: Hardcoded Message in Reusable Middleware
 * Original Problem: Error message always "Advisor association schedule is closed"
 * - Issue: Middleware used for multiple operation types (group_creation, member_addition, advisor_association)
 * - Bug: All errors showed same message regardless of operation type
 * - Solution: Dynamic message mapping based on operationType parameter
 * * Purpose:
 * Enforce time-based access control. Out-of-window responses:
 * - group_creation / member_addition: 403 + { code, reason } (legacy, tests/clients)
 * - advisor_association (Issue #70): 422 + { code, message }
 * * Applied To:
 * - POST /groups → checkScheduleWindow('group_creation')
 * - POST /groups/:groupId/members → checkScheduleWindow('member_addition')
 * - POST /advisor-requests → checkScheduleWindow('advisor_association') [Issue #61]
 * - PATCH /advisor-requests/{requestId} → checkScheduleWindow('advisor_association')
 * - DELETE /groups/:groupId/advisor → checkScheduleWindow('advisor_association')
 * - POST /groups/:groupId/advisor/transfer → checkScheduleWindow('advisor_association')
 * * NOT applied to:
 * - PATCH /groups/:groupId/override (coordinator bypass)
 * - POST /groups/advisor-sanitization (deadline-based, not schedule window)
 * * Schedule Window Model:
 * {
 * operationType: string,  // 'group_creation' | 'member_addition' | 'advisor_association'
 * startsAt: Date,         // Window open timestamp
 * endsAt: Date,           // Window close timestamp
 * isActive: boolean,      // Whether this window is active
 * coordinatorId: string   // Who set this window
 * }
 * * Query Logic:
 * - Find ScheduleWindow with matching operationType
 * - Check isActive === true
 * - Check NOW >= startsAt AND NOW <= endsAt
 * - If found: call next() (middleware passes)
 * - If not found: status depends on operationType (see handler)
 *
 * Returns Express middleware that enforces schedule boundaries for the given
 * operation type ('group_creation' | 'member_addition' | 'advisor_association').
 *
 * If no active window covers the current timestamp:
 * - advisor_association → 422 { code: 'WINDOW_CLOSED', message: '...' } (aligns with advisee API)
 * - other operation types → 403 { code: 'OUTSIDE_SCHEDULE_WINDOW', reason: '...' }
 *
 * Applied to:
 * POST /groups                      → checkScheduleWindow('group_creation')
 * POST /groups/:groupId/members     → checkScheduleWindow('member_addition')
 * POST /advisor-requests            → checkScheduleWindow('advisor_association')
 *
 * The PATCH /groups/:groupId/override endpoint is explicitly exempt (not wrapped).
 */
const checkScheduleWindow = (operationType, options = {}) => async (req, res, next) => {
  try {
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType,
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    }).lean();

    if (!activeWindow) {
      /**
       * Issue #61 Fix #7: Dynamic error message based on operationType
       * * PR Review Issue #7: Hardcoded Message in Reusable Middleware
       * * Problem:
       * - Original code always returned "Advisor association schedule is closed"
       * - This middleware is reused for 3 different operation types
       * - Result: Incorrect error messages for group_creation and member_addition
       * * Solution:
       * - Map operationType to descriptive error message
       * - Each operation type gets its specific message
       * - Fallback message for unknown operation types
       * * Message Mapping Details:
       */
      const messageMap = {
        /**
         * group_creation: Shown when POST /groups outside schedule window
         * Coordinator Action: Disables during off-window times
         * Effect: Students cannot create groups
         * Message: "Group creation schedule is closed"
         */
        group_creation: 'Group creation schedule is closed',
        /**
         * member_addition: Shown when POST /groups/:groupId/members outside window
         */
        member_addition: 'Member addition schedule is closed',
        
        /**
         * advisor_association: Shown when advisor operations outside window [Issue #61]
         * Coordinator Action: Disables during off-window times
         * Applied to:
         * - POST /advisor-requests (submit new request)
         * - PATCH /advisor-requests/{id} (make decision)
         * - DELETE /groups/:groupId/advisor (release advisor)
         * - POST /groups/:groupId/advisor/transfer (transfer advisor)
         * Effect: All advisor-related operations blocked
         * Message: "Advisor association schedule is closed"
         */
        advisor_association: 'Advisor association schedule is closed',
      };
      
      const mappedMessage = messageMap[operationType] || 'Operation is not available at this time';
      
      // Feature branch options overrides main branch defaults if provided
      const statusCode = options.statusCode || (operationType === 'advisor_association' ? 422 : 403);
      const message = options.message || mappedMessage;
      
      // Main branch issue #61 requested WINDOW_CLOSED code specifically for advisor_association
      const code = operationType === 'advisor_association' ? 'WINDOW_CLOSED' : 'OUTSIDE_SCHEDULE_WINDOW';

      return res.status(statusCode).json({
        code,
        message,
      });
    }

    next();
  } catch (err) {
    console.error('checkScheduleWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

module.exports = { checkScheduleWindow };