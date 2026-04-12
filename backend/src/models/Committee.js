const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * D3 Data Store — Committee Draft Record
 * Written by Process 4.1 (Create Committee), forwarded to Process 4.2 (Assign Advisor)
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
      maxlength: [100, 'committeeName cannot exceed 100 characters.'],
      // NOTE: uniqueness is enforced via case-insensitive collation index below
    },
    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: [500, 'description cannot exceed 500 characters.'],
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
    // Lifecycle status: draft → validated → published
    status: {
      type: String,
      enum: ['draft', 'validated', 'published'],
      default: 'draft',
    },
    // DFD flow f02: forwarded flag — marks that 4.1 has forwarded draft to 4.2
    forwardedToAdvisorAssignment: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

committeeSchema.index({ coordinatorId: 1 });
committeeSchema.index({ status: 1 });
// Case-insensitive unique index for committeeName (strength: 2 → case + accent insensitive)
committeeSchema.index(
  { committeeName: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

const Committee = mongoose.model('Committee', committeeSchema);

module.exports = Committee;
