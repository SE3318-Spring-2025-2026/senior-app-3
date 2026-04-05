const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ScheduleWindow — stores coordinator-defined group creation windows.
 *
 * Only one window can be active at a given point in time.
 * createGroup checks this collection and rejects requests outside
 * any active window (AC: schedule boundary enforcement).
 */
const scheduleWindowSchema = new mongoose.Schema(
  {
    windowId: {
      type: String,
      default: () => `sw_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true }, // coordinatorId / adminId
    label: { type: String, default: '' },        // e.g. "Spring 2026 – Group Creation"
  },
  { timestamps: true }
);

// Index used by the createGroup boundary check
scheduleWindowSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

const ScheduleWindow = mongoose.model('ScheduleWindow', scheduleWindowSchema);

module.exports = ScheduleWindow;
