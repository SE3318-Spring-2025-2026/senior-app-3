const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * checkScheduleWindow(operationType)
 *
 * Returns Express middleware that enforces schedule boundaries for the given
 * operation type ('group_creation' | 'member_addition' | 'advisor_association').
 *
 * If no active window covers the current timestamp:
 *   - advisor_association → 422 { code: 'WINDOW_CLOSED', message: '...' } (aligns with advisee API)
 *   - other operation types → 403 { code: 'OUTSIDE_SCHEDULE_WINDOW', reason: '...' }
 *
 * Applied to:
 *   POST /groups                      → checkScheduleWindow('group_creation')
 *   POST /groups/:groupId/members     → checkScheduleWindow('member_addition')
 *   POST /advisor-requests            → checkScheduleWindow('advisor_association')
 *
 * The PATCH /groups/:groupId/override endpoint is explicitly exempt (not wrapped).
 */
const checkScheduleWindow = (operationType) => async (req, res, next) => {
  try {
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType,
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    });

    if (!activeWindow) {
      if (operationType === 'advisor_association') {
        return res.status(422).json({
          code: 'WINDOW_CLOSED',
          message: 'The advisor association window is currently closed. Please check the coordinator schedule.',
        });
      }
      return res.status(403).json({
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

module.exports = { checkScheduleWindow };
