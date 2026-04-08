const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const committeeSchema = new mongoose.Schema(
  {
    committeeId: {
      type: String,
      default: () => `cmte_${uuidv4().split('-')[0]}`,
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
      validate: {
        validator: function (v) {
          // Ensure no duplicate advisor IDs
          return new Set(v).size === v.length;
        },
        message: 'Advisor list contains duplicate IDs',
      },
    },
    juryIds: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          // Ensure no duplicate jury member IDs
          return new Set(v).size === v.length;
        },
        message: 'Jury list contains duplicate IDs',
      },
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
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: { currentTime: () => new Date() } }
);

// Ensure updated timestamp on every save
committeeSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for common queries
committeeSchema.index({ committeeId: 1 });
committeeSchema.index({ committeeName: 1 });
committeeSchema.index({ status: 1 });
committeeSchema.index({ coordinatorId: 1 });

module.exports = mongoose.model('Committee', committeeSchema);
