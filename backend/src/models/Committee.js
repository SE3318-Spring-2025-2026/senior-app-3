const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * D3 Data Store — Committee Draft Record
 * Written by Process 4.1 (Create Committee), forwarded to Process 4.2 (Assign Advisor)
 * Updated by Process 4.3 (Add Jury Members), forwarded to Process 4.4 (Validate Jury)
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      default: () => `cmt_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    committeeName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    coordinatorId: {
      type: String,
      required: true,
    },
    // Process 4.2 will populate these
    advisorIds: {
      type: [String],
      default: [],
    },
    juryIds: {
      type: [String],
      default: [],
    },
    // Lifecycle status: draft → active → closed
    status: {
      type: String,
      enum: ['draft', 'active', 'closed'],
      default: 'draft',
    },
    // DFD flow f02: forwarded flag — marks that 4.1 has forwarded draft to 4.2
    forwardedToAdvisorAssignment: {
      type: Boolean,
      default: false,
    },
    // DFD flow f04: forwarded flag — marks that 4.3 has forwarded jury list to 4.4
    forwardedToJuryValidation: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

committeeSchema.index({ coordinatorId: 1 });
committeeSchema.index({ status: 1 });

const Committee = mongoose.model('Committee', committeeSchema);

module.exports = Committee;
