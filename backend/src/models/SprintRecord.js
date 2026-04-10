const mongoose = require('mongoose');

// Embedded schema for deliverable references
const deliverableRefSchema = new mongoose.Schema(
  {
    deliverableId: {
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
    },
  },
  { _id: false }
);

const SprintRecordSchema = new mongoose.Schema(
  {
    sprintRecordId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    sprintId: {
      type: String,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
    },
    committeeId: {
      type: String,
    },
    committeeAssignedAt: {
      type: Date,
    },
    deliverableRefs: {
      type: [deliverableRefSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'submitted', 'reviewed', 'completed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Create indexes
SprintRecordSchema.index({ sprintRecordId: 1 });
SprintRecordSchema.index({ sprintId: 1 });
SprintRecordSchema.index({ groupId: 1 });
SprintRecordSchema.index({ committeeId: 1 });
SprintRecordSchema.index({ sprintId: 1, groupId: 1 });
SprintRecordSchema.index({ committeeId: 1, sprintId: 1 });
SprintRecordSchema.index({ groupId: 1, status: 1 });

module.exports = mongoose.model('SprintRecord', SprintRecordSchema);
