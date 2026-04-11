const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * checkScheduleWindow(operationType, options)
 *
 * Issue #61 Resolution: Schedule Window Enforcement Middleware
 * * This middleware addresses PR Review Issue #7: Hardcoded Message in Reusable Middleware
 * * Purpose:
 * Enforce time-based access control. Out-of-window responses:
 * - group_creation / member_addition: 403 + { code, reason } (legacy, tests/clients)
 * - advisor_association (Issue #70): 422 + { code, message }
 * * Applied To:
 * - POST /groups → checkScheduleWindow('group_creation')
 * - POST /groups/:groupId/members → checkScheduleWindow('member_addition')
 * - POST /advisor-requests → checkScheduleWindow('advisor_association')
 * - PATCH /advisor-requests/{requestId} → checkScheduleWindow('advisor_association')
 * - DELETE /groups/:groupId/advisor → checkScheduleWindow('advisor_association')
 * - POST /groups/:groupId/advisor/transfer → checkScheduleWindow('advisor_association')
 * * NOT applied to:
 * - PATCH /groups/:groupId/override (coordinator bypass)
 * - POST /groups/advisor-sanitization (deadline-based, not schedule window)
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
       * * Solution: Map operationType to descriptive error message
       */
      const messageMap = {
        group_creation: 'Group creation schedule is closed',
        member_addition: 'Member addition schedule is closed',
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