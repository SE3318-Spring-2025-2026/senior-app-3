const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Committee — D3 data store for committee assignments.
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
      maxlength: [100, 'committeeName cannot exceed 100 characters.'],
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
      required: true,
    },
    forwardedToAdvisorAssignment: {
      type: Boolean,
      default: false,
    },
    forwardedToJuryValidation: {
      type: Boolean,
      default: false,
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
committeeSchema.index({ committeeId: 1 }, { unique: true });
committeeSchema.index(
  { committeeName: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);
committeeSchema.index({ coordinatorId: 1, committeeName: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
committeeSchema.index({ status: 1 });
committeeSchema.index({ coordinatorId: 1, status: 1 });

const Committee = mongoose.model('Committee', committeeSchema);

module.exports = Committee;
