const mongoose = require('mongoose');

/**
 * Committee schema (D3) — Process 4.0–4.5 lifecycle: draft → validated → published
 */
const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `COM-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    },

    committeeName: {
      type: String,
      required: true,
      unique: true,
      index: true,
      minlength: 3,
      maxlength: 100,
      trim: true,
    },

    description: {
      type: String,
      maxlength: 500,
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
      index: true,
    },

    createdBy: {
      type: String,
      required: true,
      index: true,
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    publishedBy: {
      type: String,
      default: null,
    },

    validatedAt: {
      type: Date,
      default: null,
    },

    validatedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'committees',
  }
);

committeeSchema.index({ createdBy: 1, status: 1 });
committeeSchema.index({ status: 1, publishedAt: -1 });

committeeSchema.pre('save', function preSaveCommittee(next) {
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  if (this.isModified('status') && this.status === 'validated' && !this.validatedAt) {
    this.validatedAt = new Date();
  }

  next();
});

module.exports = mongoose.model('Committee', committeeSchema);
