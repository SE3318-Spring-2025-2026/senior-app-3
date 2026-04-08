const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const advisorRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    default: () => `req_${uuidv4().split('-')[0]}`,
    unique: true
  },
  groupId: {
    type: String,
    required: true,
    index: true
  },
  professorId: {
    type: String,
    required: true,
    index: true
  },
  requesterId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  message: {
    type: String,
    maxlength: 1000
  },
  notificationTriggered: {
    type: Boolean,
    default: false
  },
  decisionReason: {
    type: String
  },
  decidedAt: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AdvisorRequest', advisorRequestSchema);
