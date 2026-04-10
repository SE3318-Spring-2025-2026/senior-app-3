const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const advisorAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: String,
      default: () => `asgn_${uuidv4().split('-')[0]}`,
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
      default: null,
    },
    status: {
      type: String,
      enum: ['assigned', 'released', 'transferred'],
      required: true,
    },
    actorId: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

advisorAssignmentSchema.index({ groupId: 1, professorId: 1, status: 1, createdAt: -1 });

const AdvisorAssignment = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);

module.exports = AdvisorAssignment;
