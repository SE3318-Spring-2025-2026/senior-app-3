const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

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
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      default: null,
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
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

committeeSchema.index({ committeeId: 1 }, { unique: true });
committeeSchema.index({ committeeName: 1 }, { unique: true });

const Committee = mongoose.model('Committee', committeeSchema);

module.exports = Committee;
