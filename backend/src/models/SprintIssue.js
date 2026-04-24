'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const sprintIssueSchema = new mongoose.Schema(
  {
    sprintIssueId: {
      type: String,
      required: true,
      unique: true,
      default: () => `spi_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
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
    issueKey: {
      type: String,
      required: true,
      index: true,
    },
    storyPoints: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      default: null,
    },
    assigneeAccountId: {
      type: String,
      default: null,
    },
    assigneeDisplayName: {
      type: String,
      default: null,
    },
    rawIssue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'sprint_issues',
  }
);

sprintIssueSchema.index({ groupId: 1, sprintId: 1, issueKey: 1 }, { unique: true });
sprintIssueSchema.index({ groupId: 1, sprintId: 1, syncedAt: -1 });

module.exports = mongoose.model('SprintIssue', sprintIssueSchema);
