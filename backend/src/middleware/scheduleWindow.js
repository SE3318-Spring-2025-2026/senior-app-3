const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * checkScheduleWindow(operationType, options)
 *
 * Returns Express middleware that enforces schedule boundaries for the given
 * operation type ('group_creation' | 'member_addition' | 'advisor_association').
 *
 * If no active window covers the current timestamp, responds with:
 *   403 { code: 'OUTSIDE_SCHEDULE_WINDOW', reason: '...' }
 *
 * Applied to:
 *   POST /groups                      → checkScheduleWindow('group_creation')
 *   POST /groups/:groupId/members     → checkScheduleWindow('member_addition')
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
    });

    if (!activeWindow) {
      const statusCode = options.statusCode || 403;
      const message = options.message || 'Operation not available outside the configured schedule window';
      return res.status(statusCode).json({
        code: 'OUTSIDE_SCHEDULE_WINDOW',
        reason: message,
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
