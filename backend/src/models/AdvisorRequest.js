const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); // Main branch'ten gelen ID oluşturucu

/**
 * Issue #61: AdvisorRequest Model (D2 Extension)
 * * Data Store: D2 - Advisory Assignment Tracking
 * * Purpose:
 * Stores advisor request records for Process 3.0-3.7 workflow.
 * Tracks all advisor association requests and their lifecycle.
 */
const advisorRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      default: () => `req_${uuidv4().split('-')[0]}`, // Main'in otomatik ID üretimi
      unique: true,
      index: true,
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
    message: {
      type: String,
      default: '',
      maxlength: 1000, // Main'in karakter sınırı eklendi
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'], // Main'deki 'cancelled' eklendi
      default: 'pending',
      index: true,
    },
    notificationTriggered: {
      type: Boolean,
      default: false,
    },
    decision: {
      type: String,
      enum: ['approved', 'rejected'],
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    decisionReason: {
      type: String // Main'den gelen olası veri kayıplarını önlemek için eklendi
    },
    decidedAt: Date,
    decidedBy: String,
  },
  {
    timestamps: true,
  }
);

/**
 * Unique Partial Index for Duplicate Prevention
 * Prevents concurrent duplicate pending requests per group
 */
advisorRequestSchema.index(
  { groupId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'groupId_pending_status_unique',
  }
);

// Additional Indexes for Query Optimization
advisorRequestSchema.index({ professorId: 1 });
advisorRequestSchema.index({ status: 1, createdAt: -1 });
advisorRequestSchema.index({ groupId: 1, status: 1 });

module.exports = mongoose.model('AdvisorRequest', advisorRequestSchema);