const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const approvalQueueSchema = new mongoose.Schema(
  {
    queueId: {
      type: String,
      default: () => `aq_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
    notificationId: {
      type: String,
      required: true,
    },
    studentId: {
      type: String,
      required: true,
    },
    decision: {
      type: String,
      enum: ['approved', 'rejected'],
      required: true,
    },
    decidedBy: {
      type: String,
      required: true,
    },
    decidedAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending',
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Unique constraint: each (notification, group, student) is forwarded only once
approvalQueueSchema.index(
  { notificationId: 1, groupId: 1, studentId: 1 },
  { unique: true }
);

approvalQueueSchema.index({ groupId: 1, status: 1 });
approvalQueueSchema.index({ notificationId: 1 });

const ApprovalQueue = mongoose.model('ApprovalQueue', approvalQueueSchema);

module.exports = ApprovalQueue;
