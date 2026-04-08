const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const advisorRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      default: () => `arq_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    professorId: {
      type: String,
      required: true,
      index: true,
    },
    requesterId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    message: {
      type: String,
      default: '',
    },
    reason: {
      type: String,
      default: '',
    },
    notificationTriggered: {
      type: Boolean,
      default: false,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

advisorRequestSchema.index({ groupId: 1, status: 1 });
advisorRequestSchema.index({ professorId: 1, status: 1, createdAt: -1 });

const AdvisorRequest = mongoose.model('AdvisorRequest', advisorRequestSchema);

module.exports = AdvisorRequest;
