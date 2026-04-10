const mongoose = require('mongoose');

const DeliverableSchema = new mongoose.Schema(
  {
    deliverableId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    committeeId: {
      type: String,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
    studentId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['proposal', 'statement-of-work', 'demonstration'],
      required: true,
    },
    submittedAt: {
      type: Date,
      default: () => new Date(),
    },
    storageRef: {
      type: String,
      required: true,
      minlength: 5,
      maxlength: 2048,
    },
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'accepted', 'rejected'],
      default: 'submitted',
    },
    feedback: {
      type: String,
    },
    reviewedBy: {
      type: String,
    },
    reviewedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

DeliverableSchema.index({ deliverableId: 1 });
DeliverableSchema.index({ committeeId: 1 });
DeliverableSchema.index({ groupId: 1 });
DeliverableSchema.index({ type: 1 });
DeliverableSchema.index({ committeeId: 1, groupId: 1 });
DeliverableSchema.index({ groupId: 1, type: 1 });
DeliverableSchema.index({ submittedAt: -1 });

module.exports = mongoose.model('Deliverable', DeliverableSchema);
