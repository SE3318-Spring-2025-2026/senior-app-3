const mongoose = require('mongoose');

const advisorAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: String,
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
    },
    status: {
      type: String,
      enum: ['assigned', 'released', 'transferred'],
      required: true,
    },
    previousProfessorId: {
      type: String,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index for efficient queries
advisorAssignmentSchema.index({ groupId: 1, status: 1 });
advisorAssignmentSchema.index({ professorId: 1 });

const AdvisorAssignment = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);

module.exports = AdvisorAssignment;
