const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const advisorRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      default: () => `areq_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
    professorId: {
      type: String,
      required: true,
    },
    requesterId: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    decision: {
      type: String,
      enum: ['approve', 'reject', null],
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
    decisionBy: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    notificationTriggered: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

advisorRequestSchema.index({ requestId: 1 }, { unique: true });
advisorRequestSchema.index({ professorId: 1, status: 1 });
advisorRequestSchema.index({ groupId: 1 });

const AdvisorRequest = mongoose.model('AdvisorRequest', advisorRequestSchema);

module.exports = AdvisorRequest;
