const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const overrideSchema = new mongoose.Schema(
  {
    overrideId: {
      type: String,
      default: () => `ovr_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      enum: ['add_member', 'remove_member', 'update_group'],
      required: true,
    },
    targetStudentId: {
      type: String,
      default: null,
    },
    updates: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      required: true,
    },
    coordinatorId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['applied', 'reconciled', 'failed'],
      default: 'applied',
    },
    reconciledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

overrideSchema.index({ groupId: 1, status: 1 });
overrideSchema.index({ coordinatorId: 1 });

const Override = mongoose.model('Override', overrideSchema);

module.exports = Override;
