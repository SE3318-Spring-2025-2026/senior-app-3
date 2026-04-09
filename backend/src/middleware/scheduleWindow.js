const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * checkScheduleWindow(operationType)
 *
 * Returns Express middleware that enforces schedule boundaries for the given
 * operation type ('group_creation' | 'member_addition').
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

module.exports = { checkScheduleWindow, checkAdvisorAssociationSchedule };

/**
 * checkAdvisorAssociationSchedule()
 *
 * Returns Express middleware that enforces schedule boundaries for advisor association operations.
 * Returns 422 (not 403) to distinguish from authorization failures per OpenAPI spec.
 *
 * If no active window for 'advisor_association' covers the current timestamp, responds with:
 *   422 { code: 'SCHEDULE_WINDOW_CLOSED', message: 'Advisor association schedule is closed' }
 *
 * Applied to:
 *   POST /advisor-requests                      → group leader advisor request submission
 *   PATCH /advisor-requests/:requestId          → professor advisor decision (approve/reject)
 *   DELETE /groups/:groupId/advisor             → team lead/advisor release request
 *   POST /groups/:groupId/advisor/transfer      → coordinator advisor transfer
 *
 * Explicitly NOT applied to:
 *   POST /groups/advisor-sanitization           → uses deadline-based gating instead (3.7)
 */
const checkAdvisorAssociationSchedule = () => async (req, res, next) => {
  try {
    const now = new Date();
    const activeWindow = await ScheduleWindow.findOne({
      operationType: 'advisor_association',
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    });

    if (!activeWindow) {
      return res.status(422).json({
        code: 'SCHEDULE_WINDOW_CLOSED',
        message: 'Advisor association schedule is closed',
      });
    }

    next();
  } catch (err) {
    console.error('checkAdvisorAssociationSchedule error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

