const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * SprintRecord — D6 data store for sprint and contribution tracking.
 *
 * Tracks each group's sprint performance, committee assignment, and links to
 * deliverables submitted during that sprint phase.
 *
 * Flows:
 *   - Flow f13 (Process 4.5 → D6): Updated with committeeId and committeeAssignedAt on committee publish
 *   - Flow f14 (D4 → D6): Cross-referenced with deliverable entries after submission
 *
 * One SprintRecord per (sprint, group) pair, linked to Committee for evaluation context.
 */
const sprintRecordSchema = new mongoose.Schema(
  {
    sprintRecordId: {
      type: String,
      default: () => `spr_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    sprintId: {
      type: String,
      required: true,
      indexed: true,
    },
    groupId: {
      type: String,
      required: true,
      indexed: true,
    },
    committeeId: {
      type: String,
      default: null,
    },
    committeeAssignedAt: {
      type: Date,
      default: null,
    },
    deliverableRefs: {
      type: [
        {
          deliverableId: String,
          type: { type: String, enum: ['proposal', 'statement_of_work', 'demonstration'] },
          submittedAt: Date,
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'submitted', 'reviewed', 'completed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Indexes for efficient querying
sprintRecordSchema.index({ sprintRecordId: 1 });
sprintRecordSchema.index({ sprintId: 1, groupId: 1 });
sprintRecordSchema.index({ committeeId: 1, sprintId: 1 });
sprintRecordSchema.index({ groupId: 1, status: 1 });

const SprintRecord = mongoose.model('SprintRecord', sprintRecordSchema);

module.exports = SprintRecord;
