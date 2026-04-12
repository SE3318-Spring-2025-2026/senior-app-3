const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { VALID_OPERATION_TYPES } = require('../utils/operationTypes');

/**
 * ScheduleWindow — stores coordinator-defined schedule windows per operation type.
 *
 * Each window is scoped to an operationType:
 * - 'group_creation': bounds POST /groups (Process 2.1)
 * - 'member_addition': bounds POST /groups/:groupId/members (Process 2.3)
 * - 'advisor_association': bounds advisor request/approval/release/transfer (Process 3.1-3.6)
 *
 * Only one active window per operationType may cover a given point in time.
 * Boundary checks in middleware reject requests outside an active window for their respective operationType.
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
      enum: VALID_OPERATION_TYPES,
      required: true,
      /**
       * =====================================================================
       * FIX #4: OPERATIONTYPE NAMING CONVENTION DOCUMENTATION (ISSUE #70 - LOW)
       * =====================================================================
       * NAMING PATTERN CONSISTENCY:
       * - Field name in Schema: camelCase (operationType)
       * - Enum values in database: snake_case ('group_creation', 'member_addition', 'advisor_association')
       * - Field name in API serialization: snake_case (operation_type in JSON responses)
       *
       * WHY THIS PATTERN:
       * JavaScript/Mongoose conventions use camelCase for field names (operationType).
       * Database values and API JSON responses use snake_case enum strings for consistency
       * with REST API naming conventions and DFD process naming.
       *
       * VALIDATION: All enum values are already snake_case strings ✓
       * All references in code use consistent enum values ✓
       * =====================================================================
       */
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