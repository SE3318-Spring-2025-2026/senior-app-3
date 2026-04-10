const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Committee — D3 data store for committee assignments.
 *
 * Stores committee records created by Coordinator in Process 4.0.
 * Each committee is composed of advisors and jury members assigned to evaluate
 * one or more groups.
 *
 * Lifecycle:
 *   - Created in draft state (Process 4.1)
 *   - Advisors assigned (Process 4.2)
 *   - Jury members assigned (Process 4.3)
 *   - Validated (Process 4.4)
 *   - Published (Process 4.5)
 *
 * Linked to:
 *   - Groups (D2): via implicit association through D6 SprintRecords
 *   - Users (D1): advisorIds and juryIds reference professor/committee_member records
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      default: () => `com_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    committeeName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    advisorIds: {
      type: [String],
      default: [],
    },
    juryIds: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
    },
    createdBy: {
      type: String,
      required: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    publishedBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes for efficient querying
committeeSchema.index({ committeeId: 1 });
committeeSchema.index({ committeeName: 1 });
committeeSchema.index({ status: 1 });
committeeSchema.index({ createdBy: 1, status: 1 });

const Committee = mongoose.model('Committee', committeeSchema);

module.exports = Committee;
