const mongoose = require('mongoose');

const advisorRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    required: true,
    unique: true,
  },
  groupId: {
    type: String,
    required: true,
  },
  professorId: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  reason: {
    type: String,
    default: null,
  },
  createdBy: {
    type: String,
    required: true,
  },
  processedAt: {
    type: Date,
    default: null
  },
  notificationTriggered: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  collection: 'advisorrequests',
});

// Ensure a group cannot have multiple pending requests for the same professor
advisorRequestSchema.index({ groupId: 1, professorId: 1, status: 1 }, { 
  unique: true, 
  partialFilterExpression: { status: 'pending' } 
});

module.exports = mongoose.model('AdvisorRequest', advisorRequestSchema);
