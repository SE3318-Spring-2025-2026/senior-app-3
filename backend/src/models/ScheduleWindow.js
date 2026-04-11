const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ScheduleWindow — stores coordinator-defined schedule windows per operation type.
 *
 * Each window is scoped to an operationType:
 * - 'group_creation': window for group creation (Process 2.1)
 * - 'member_addition': window for member addition (Process 2.3)
 * - 'advisor_association': window for advisor association (Process 3.0)
 *
 * Only one active window per operationType may cover a given point in time.
 * Boundary checks reject requests outside an active window for their respective operationType.
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
      enum: ['group_creation', 'member_addition', 'advisor_association'],
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

// Index used by boundary checks: filter by operationType + active status + time range
scheduleWindowSchema.index({ operationType: 1, isActive: 1, startsAt: 1, endsAt: 1 });

const ScheduleWindow = mongoose.model('ScheduleWindow', scheduleWindowSchema);

module.exports = ScheduleWindow;