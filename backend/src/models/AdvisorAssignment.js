const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const advisorAssignmentSchema = new mongoose.Schema({
  assignmentId: {
    type: String,
    default: () => `asn_${uuidv4().split('-')[0]}`,
    unique: true,
    required: true
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
  status: {
    type: String,
    enum: ['assigned', 'released', 'transferred'],
    required: true
  },
  updatedBy: {
    type: String,
    required: true
  },
  reason: {
    type: String,
    maxlength: 1000,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);
