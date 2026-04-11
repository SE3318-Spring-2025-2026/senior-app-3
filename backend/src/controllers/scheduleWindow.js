const ScheduleWindow = require('../models/ScheduleWindow');

const VALID_OPERATION_TYPES = new Set(['group_creation', 'member_addition']);

/**
 * GET /schedule-window/active?operationType=group_creation
 * Returns the currently active schedule window for the given operation type.
 * Used by the frontend to show open/closed status on creation/member-add pages.
 */
const getActiveWindow = async (req, res) => {
  try {
    const { operationType } = req.query;

    if (!operationType || !VALID_OPERATION_TYPES.has(operationType)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: "operationType query param must be 'group_creation' or 'member_addition'.",
      });
    }

    const now = new Date();
    const window = await ScheduleWindow.findOne({
      operationType,
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
        operationType: window.operationType,
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
 * GET /schedule-window
 * Returns all schedule windows (active and inactive) for coordinator panel display.
 * Optional query param: ?operationType=group_creation|member_addition
 */
const listWindows = async (req, res) => {
  try {
    const { operationType } = req.query;
    const filter = {};
    if (operationType) {
      if (!VALID_OPERATION_TYPES.has(operationType)) {
        return res.status(400).json({
          code: 'INVALID_INPUT',
          message: "operationType must be 'group_creation' or 'member_addition'.",
        });
      }
      filter.operationType = operationType;
    }

    const windows = await ScheduleWindow.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      windows: windows.map((w) => ({
        windowId: w.windowId,
        operationType: w.operationType,
        label: w.label,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        isActive: w.isActive,
        createdBy: w.createdBy,
        createdAt: w.createdAt,
      })),
    });
  } catch (err) {
    console.error('listWindows error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * POST /schedule-window
 * Coordinator/admin creates a new schedule window for a specific operation type.
 * Body: { operationType, startsAt, endsAt, label? }
 *
 * Deactivates any existing windows of the same operationType that overlap with the new one.
 */
const createWindow = async (req, res) => {
  try {
    const { operationType, startsAt, endsAt, label } = req.body;

    if (!operationType || !VALID_OPERATION_TYPES.has(operationType)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: "operationType must be 'group_creation' or 'member_addition'.",
      });
    }

    if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'startsAt must be a valid date.' });
    }

    if (!endsAt || Number.isNaN(new Date(endsAt).getTime())) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'endsAt must be a valid date.' });
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    // Explicitly normalize to ISO/UTC so stored instants are not tied to server-local parsing quirks
    const utcStart = new Date(start.toISOString());
    const utcEnd = new Date(end.toISOString());

    if (utcEnd <= utcStart) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'endsAt must be after startsAt.' });
    }

    // Deactivate overlapping windows of the same operationType
    await ScheduleWindow.updateMany(
      {
        operationType,
        isActive: true,
        startsAt: { $lt: utcEnd },
        endsAt: { $gt: utcStart },
      },
      { $set: { isActive: false } }
    );

    const window = await ScheduleWindow.create({
      operationType,
      startsAt: utcStart,
      endsAt: utcEnd,
      isActive: true,
      createdBy: req.user.userId,
      label: label || '',
    });

    return res.status(201).json({
      windowId: window.windowId,
      operationType: window.operationType,
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

    await ScheduleWindow.updateOne({ windowId }, { $set: { isActive: false } });

    return res.status(200).json({ windowId: window.windowId, isActive: false });
  } catch (err) {
    console.error('deactivateWindow error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

module.exports = { getActiveWindow, listWindows, createWindow, deactivateWindow };
