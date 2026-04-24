'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const sprintReportSchema = new mongoose.Schema(
  {
    sprintReportId: {
      type: String,
      required: true,
      unique: true,
      default: () => `sprpt_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    sprintId: {
      type: String,
      required: true,
      index: true,
    },
    reportType: {
      type: String,
      default: 'coordinator_summary',
    },
    deliverableId: {
      type: String,
      default: null,
    },
    deliverableIds: {
      type: [String],
      default: [],
    },
    sourceVersionRef: {
      type: String,
      default: null,
    },
    sourceContributionCollection: {
      type: String,
      default: 'sprint_contributions',
    },
    summary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    contributionSnapshot: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'sprint_reports',
  }
);

sprintReportSchema.index({ groupId: 1, sprintId: 1, reportType: 1 }, { unique: true });
sprintReportSchema.index({ groupId: 1, sprintId: 1, generatedAt: -1 });
sprintReportSchema.index({ deliverableId: 1, sprintId: 1 });
sprintReportSchema.index({ deliverableIds: 1 });
sprintReportSchema.index({ sourceVersionRef: 1 });

module.exports = mongoose.model('SprintReport', sprintReportSchema);
