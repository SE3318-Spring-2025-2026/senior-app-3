const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ScheduleWindow — stores coordinator-defined schedule windows per operation type.
 *
 * One window per operation_type can be active at a given point in time.
 * Boundary check middleware enforces these windows on group creation and
 * member addition endpoints (AC: schedule boundary enforcement).
 */
const scheduleWindowSchema = new mongoose.Schema(
  {
    windowId: {
      type: String,
      default: () => `sw_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    operationType: {
      type: String,
      enum: ['group_creation', 'member_addition'],
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

// Index used by the schedule boundary check middleware
scheduleWindowSchema.index({ operationType: 1, isActive: 1, startsAt: 1, endsAt: 1 });

const ScheduleWindow = mongoose.model('ScheduleWindow', scheduleWindowSchema);

module.exports = ScheduleWindow;
