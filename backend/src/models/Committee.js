const mongoose = require('mongoose');

const CommitteeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    committeeName: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
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
    },
    publishedBy: {
      type: String,
    },
    validatedAt: {
      type: Date,
    },
    validatedBy: {
      type: String,
    },
  },
  { timestamps: true }
);

// Create indexes
CommitteeSchema.index({ committeeId: 1 });
CommitteeSchema.index({ committeeName: 1 });
CommitteeSchema.index({ status: 1 });
CommitteeSchema.index({ createdBy: 1, status: 1 });
CommitteeSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model('Committee', CommitteeSchema);
