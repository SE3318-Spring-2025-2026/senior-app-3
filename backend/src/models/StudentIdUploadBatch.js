const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const studentIdUploadBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      default: () => `batch_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    fileHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    coordinatorId: {
      type: String,
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    totalRecords: {
      type: Number,
      required: true,
      min: 0,
    },
    insertedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    updatedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    rejectedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    rejectedRows: [
      {
        rowNumber: Number,
        studentId: String,
        reason: String,
        details: String,
      },
    ],
    uploadedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
  }
);

// Index for querying uploads by coordinator
studentIdUploadBatchSchema.index({ coordinatorId: 1, uploadedAt: -1 });

const StudentIdUploadBatch = mongoose.model('StudentIdUploadBatch', studentIdUploadBatchSchema);

module.exports = StudentIdUploadBatch;
