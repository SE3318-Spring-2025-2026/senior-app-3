const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * AdvisorAssignment — Historical audit trail for all advisor state transitions.
 *
 * Tracks every assignment, release, and transfer operation to maintain a complete
 * audit trail per group. Used by Process 3.5 to record advisor state changes.
 *
 * One document per state transition:
 *   - Approval: status='assigned', professorId populated
 *   - Release: status='released', professorId cleared, previousProfessorId populated
 *   - Transfer: status='transferred', professorId updated, previousProfessorId populated
 */
const advisorAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: String,
      default: () => `asn_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    groupId: {
      type: String,
      required: true,
      indexed: true,
    },
    professorId: {
      type: String,
      default: null,
    },
    previousProfessorId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['assigned', 'released', 'transferred'],
      required: true,
    },
    updatedBy: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: '',
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

advisorAssignmentSchema.index({ groupId: 1, status: 1 });
advisorAssignmentSchema.index({ professorId: 1 });

const AdvisorAssignment = mongoose.model('AdvisorAssignment', advisorAssignmentSchema);

module.exports = AdvisorAssignment;
