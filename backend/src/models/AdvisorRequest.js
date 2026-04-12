const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const advisorRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      // Using 'arq_' prefix from main for consistency
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
      required: true 
    },
    status: {
      type: String,
      // Combined enums from both branches
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    message: {
      type: String,
      maxlength: 1000,
    },
    reason: { // Main branch uses 'reason' for decision feedback
      type: String,
      default: null,
    },
    notificationTriggered: {
      type: Boolean,
      default: false,
    },
    processedAt: { // Timestamp for when the decision was made
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'advisorrequests',
  }
);

/**
 * Partial Unique Index (from Main):
 * Prevents a group from spamming a professor with multiple pending requests.
 * Once a request is approved/rejected/cancelled, they can request again.
 */
advisorRequestSchema.index(
  { groupId: 1, professorId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);

module.exports = mongoose.model('AdvisorRequest', advisorRequestSchema);