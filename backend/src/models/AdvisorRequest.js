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
    },
    message: {
      type: String,
      maxlength: 1000,
    },
    reason: {
      type: String,
      default: null,
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
  {
    timestamps: true,
    collection: 'advisorrequests',
  }
);

advisorRequestSchema.index(
  { groupId: 1, professorId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);

module.exports = mongoose.model('AdvisorRequest', advisorRequestSchema);
