const ScheduleWindow = require('../models/ScheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');
const { VALID_OPERATION_TYPES } = OPERATION_TYPES;

/**
 * @param {string} operationType — Must be one of `VALID_OPERATION_TYPES`
 */
const assertRegisteredScheduleOperationType = (operationType) =>
  VALID_OPERATION_TYPES.includes(operationType);

/**
 * checkScheduleWindow(operationType, options)
 *
 * Issue #61 & #70 Resolution: Schedule Window Enforcement Middleware
 * * Purpose: Enforce time-based access control. 
 * - group_creation / member_addition: 403 (Forbidden)
 * - advisor_association (Issue #70): 422 (Unprocessable Entity)
 */
const checkScheduleWindow = (operationType, options = {}) => async (req, res, next) => {
  try {
    if (!assertRegisteredScheduleOperationType(operationType)) {
      return res.status(500).json({
        code: 'SERVER_ERROR',
        message: 'Invalid schedule operation type configured in route.',
      });
    }

    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType,
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    }).lean();

    if (!activeWindow) {
      /**
       * Issue #61 Fix #7: Dynamic error message mapping
       */
      const messageMap = {
        group_creation: 'Group creation schedule is closed',
        member_addition: 'Member addition schedule is closed',
        advisor_association: 'Advisor association schedule is closed',
      };
      
      const mappedMessage = messageMap[operationType] || 'Operation is not available at this time';
      
      // Feature branch options override defaults
      const statusCode = options.statusCode || (operationType === 'advisor_association' ? 422 : 403);
      const message = options.message || mappedMessage;
      
      // Use specific code for advisor operations to distinguish from standard window issues
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

/**
 * checkAdvisorOperationWindow()
 * Specialized middleware for advisor/association flows (Issue #70 & #75).
 * Always returns 422 per OpenAPI spec requirements for schedule violations.
 */
const checkAdvisorOperationWindow = (operationType = 'advisor_association') => async (req, res, next) => {
  try {
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType,
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    }).lean();

    if (!activeWindow) {
      return res.status(422).json({
        code: 'SCHEDULE_WINDOW_CLOSED',
        message: `${operationType.replace('_', ' ')} schedule is closed`,
      });
    }

    next();
  } catch (err) {
    console.error('checkAdvisorOperationWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * =====================================================================
 * FIX #2: MODULE EXPORT ORDER (ISSUE #70 - CRITICAL)
 * =====================================================================
 * PROBLEM: Temporal Dead Zone (TDZ) error if exported before declaration.
 * SOLUTION: Move module.exports to the END of the file.
 * =====================================================================
 */
module.exports = { 
  checkScheduleWindow, 
  checkAdvisorOperationWindow,
  assertRegisteredScheduleOperationType,
  OPERATION_TYPES 
};