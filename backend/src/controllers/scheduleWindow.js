const ScheduleWindow = require('../models/ScheduleWindow');

const VALID_OPERATION_TYPES = ['group_creation', 'member_addition'];

/**
 * GET /schedule-window/active
 * Returns the currently active schedule window for a given operation type.
 * Query param: ?type=group_creation | member_addition
 * Used by the frontend to show open/closed status.
 */
const getActiveWindow = async (req, res) => {
  try {
    const { type } = req.query;

    if (type && !VALID_OPERATION_TYPES.includes(type)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: `type must be one of: ${VALID_OPERATION_TYPES.join(', ')}`,
      });
    }

    const now = new Date();
    const query = {
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
    };
    if (type) query.operationType = type;

    const window = await ScheduleWindow.findOne(query);

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
 * Returns all schedule windows (active and inactive), ordered by creation date desc.
 * Used by the Coordinator Panel UI to display current configuration.
 */
const getAllWindows = async (req, res) => {
  try {
    const { type } = req.query;

    const query = {};
    if (type) {
      if (!VALID_OPERATION_TYPES.includes(type)) {
        return res.status(400).json({
          code: 'INVALID_INPUT',
          message: `type must be one of: ${VALID_OPERATION_TYPES.join(', ')}`,
        });
      }
      query.operationType = type;
    }

    const windows = await ScheduleWindow.find(query).sort({ createdAt: -1 });

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
    console.error('getAllWindows error:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
};

/**
 * POST /schedule-window
 * Coordinator/admin creates a new schedule window for a specific operation type.
 * Body: { operationType, startsAt, endsAt, label? }
 *
 * Deactivates any existing windows of the same operationType that overlap.
 */
const createWindow = async (req, res) => {
  try {
    const { operationType, startsAt, endsAt, label } = req.body;

    if (!operationType || !VALID_OPERATION_TYPES.includes(operationType)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: `operationType must be one of: ${VALID_OPERATION_TYPES.join(', ')}`,
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

    if (end <= start) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'endsAt must be after startsAt.' });
    }

    // Deactivate overlapping windows of the same operation type
    await ScheduleWindow.updateMany(
      {
        operationType,
        isActive: true,
        startsAt: { $lt: end },
        endsAt: { $gt: start },
      },
      { $set: { isActive: false } }
    );

    const window = await ScheduleWindow.create({
      operationType,
      startsAt: start,
      endsAt: end,
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

module.exports = { getActiveWindow, getAllWindows, createWindow, deactivateWindow };
