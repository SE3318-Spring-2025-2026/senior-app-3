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
    },
    description: {
      type: String,
      default: null,
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
  { timestamps: true }
);

committeeSchema.index({ committeeId: 1 });
committeeSchema.index({ status: 1 });

const Committee = mongoose.model('Committee', committeeSchema);
module.exports = Committee;
