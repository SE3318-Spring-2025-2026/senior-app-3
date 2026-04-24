'use strict';

const mongoose = require('mongoose');

/**
 * SprintConfig Schema (D8 Data Store — Rubrics & Sprint Configurations)
 *
 * Stores per-sprint, per-deliverable-type configuration including submission deadlines.
 * Queried during Process 5.4 (deadline validation) to determine whether a submission
 * is within the allowed window.
 */
const sprintConfigSchema = new mongoose.Schema(
  {
    sprintId: {
      type: String,
      required: true,
      index: true,
    },
    groupId: {
      type: String,
      default: null,
      index: true,
    },
    deliverableType: {
      type: String,
      enum: ['proposal', 'statement_of_work', 'demo', 'interim_report', 'final_report'],
      required: true,
    },
    deadline: {
      type: Date,
      required: true,
    },
    description: {
      type: String,
      default: null,
    },
    configurationStatus: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    externalSprintKey: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'sprint_configs',
  }
);

// Each sprint+deliverableType pair must be unique
sprintConfigSchema.index({ sprintId: 1, deliverableType: 1 }, { unique: true });

module.exports = mongoose.model('SprintConfig', sprintConfigSchema);
