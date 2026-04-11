const ScheduleWindow = require('../models/ScheduleWindow');
const OPERATION_TYPES = require('../utils/operationTypes');
const { VALID_OPERATION_TYPES } = OPERATION_TYPES;

/**
 * @param {string} operationType — Must be one of `VALID_OPERATION_TYPES` (values of
 *   `GROUP_CREATION`, `MEMBER_ADDITION`, `ADVISOR_ASSOCIATION`, `ADVISOR_DECISION`,
 *   `ADVISOR_RELEASE`, `ADVISOR_TRANSFER`, `ADVISOR_SANITIZATION` in `operationTypes.js`).
 */
const assertRegisteredScheduleOperationType = (operationType) =>
  VALID_OPERATION_TYPES.includes(operationType);

/**
 * checkScheduleWindow(operationType)
 *
 * Returns Express middleware that enforces schedule boundaries for the given
 * operation type. Valid values are the string constants exported from
 * `utils/operationTypes.js` (see keys: GROUP_CREATION, MEMBER_ADDITION, …).
 *
 * If `operationType` is not a registered schedule operation, responds with 500
 * (misconfigured route). If no active window covers the current timestamp, responds with:
 *   422 { code: 'OUTSIDE_SCHEDULE_WINDOW', reason: '...' }
 *
 * Applied to:
 *   POST /groups/:groupId/members     → checkScheduleWindow(OPERATION_TYPES.MEMBER_ADDITION)
 *
 * Advisor flows use `checkAdvisorOperationWindow` instead (ADVISOR_* operation types).
 * The PATCH /groups/:groupId/override endpoint is explicitly exempt (not wrapped).
 */
const checkScheduleWindow = (operationType) => async (req, res, next) => {
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
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'OUTSIDE_SCHEDULE_WINDOW',
        reason: 'Operation not available outside the configured schedule window',
      });
    }

    next();
  } catch (err) {
    console.error('checkScheduleWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * Advisor / Issue #75 flows return 422 when no active window covers "now"
 * (contract tests expect 422 for out-of-window advisor operations).
 *
 * @param {string} operationType — One of ADVISOR_ASSOCIATION, ADVISOR_DECISION,
 *   ADVISOR_RELEASE, ADVISOR_TRANSFER, or ADVISOR_SANITIZATION.
 */
const checkAdvisorOperationWindow = (operationType) => async (req, res, next) => {
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
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'OUTSIDE_SCHEDULE_WINDOW',
        message: 'Operation not available outside the configured schedule window',
      });
    }

    next();
  } catch (err) {
    console.error('checkAdvisorOperationWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

module.exports = {
  checkScheduleWindow,
  checkAdvisorOperationWindow,
  OPERATION_TYPES,
};
