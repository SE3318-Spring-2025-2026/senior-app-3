const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const studentIdRegistrySchema = new mongoose.Schema(
  {
    registryId: {
      type: String,
      default: () => `reg_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    studentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['valid', 'rejected'],
      default: 'valid',
    },
    uploadBatchId: {
      type: String,
      required: true,
      index: true,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    updatedByBatchId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient lookups during validation
studentIdRegistrySchema.index({ studentId: 1, status: 1 });
studentIdRegistrySchema.index({ email: 1, status: 1 });

const StudentIdRegistry = mongoose.model('StudentIdRegistry', studentIdRegistrySchema);

module.exports = StudentIdRegistry;
