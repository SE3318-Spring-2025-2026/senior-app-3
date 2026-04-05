const ScheduleWindow = require('../models/ScheduleWindow');

/**
 * GET /schedule-window/active
 * Returns the currently active schedule window (if any).
 * Used by the frontend to show open/closed status on the group creation page.
 */
const getActiveWindow = async (req, res) => {
  try {
    const now = new Date();
    const window = await ScheduleWindow.findOne({
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    });

    if (!window) {
      return res.status(200).json({ open: false, window: null });
    }

    return res.status(200).json({
      open: true,
      window: {
        windowId: window.windowId,
        label: window.label,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
    });
  } catch (err) {
    console.error('getActiveWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * POST /schedule-window
 * Coordinator/admin creates a new schedule window.
 * Body: { startsAt, endsAt, label? }
 *
 * Deactivates any existing windows that overlap with the new one.
 */
const createWindow = async (req, res) => {
  try {
    const { startsAt, endsAt, label } = req.body;

    if (!startsAt || isNaN(new Date(startsAt).getTime())) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'startsAt must be a valid date.' });
    }

    if (!endsAt || isNaN(new Date(endsAt).getTime())) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'endsAt must be a valid date.' });
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (end <= start) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'endsAt must be after startsAt.' });
    }

    // Deactivate overlapping windows so only one is active at a time
    await ScheduleWindow.updateMany(
      {
        isActive: true,
        startsAt: { $lt: end },
        endsAt: { $gt: start },
      },
      { $set: { isActive: false } }
    );

    const window = await ScheduleWindow.create({
      startsAt: start,
      endsAt: end,
      isActive: true,
      createdBy: req.user.userId,
      label: label || '',
    });

    return res.status(201).json({
      windowId: window.windowId,
      label: window.label,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      createdBy: window.createdBy,
      createdAt: window.createdAt,
    });
  } catch (err) {
    console.error('createWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * DELETE /schedule-window/:windowId
 * Coordinator/admin deactivates a schedule window.
 */
const deactivateWindow = async (req, res) => {
  try {
    const { windowId } = req.params;

    const window = await ScheduleWindow.findOne({ windowId });
    if (!window) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Schedule window not found.' });
    }

    window.isActive = false;
    await window.save();

    return res.status(200).json({ windowId: window.windowId, isActive: false });
  } catch (err) {
    console.error('deactivateWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

module.exports = { getActiveWindow, createWindow, deactivateWindow };
