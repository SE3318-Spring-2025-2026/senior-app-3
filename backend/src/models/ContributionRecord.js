const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ContributionRecord — D6 contribution tracking per student per sprint.
 *
 * Tracks individual student contributions within a sprint:
 *   - Story points completed
 *   - Pull requests merged
 *   - Issues resolved
 *   - Contribution ratio (calculated from GitHub integration)
 *
 * Used by Process 8 (Final Grade Calculation) to determine individual grades
 * separate from group grades.
 *
 * One ContributionRecord per (sprint, student, group) triple.
 */
const contributionRecordSchema = new mongoose.Schema(
  {
    contributionRecordId: {
      type: String,
      default: () => `ctr_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    sprintId: {
      type: String,
      required: true,
      indexed: true,
    },
    studentId: {
      type: String,
      required: true,
      indexed: true,
    },
    groupId: {
      type: String,
      required: true,
      indexed: true,
    },
    storyPointsAssigned: {
      type: Number,
      default: 0,
    },
    storyPointsCompleted: {
      type: Number,
      default: 0,
    },
    pullRequestsMerged: {
      type: Number,
      default: 0,
    },
    issuesResolved: {
      type: Number,
      default: 0,
    },
    commitsCount: {
      type: Number,
      default: 0,
    },
    jiraIssueKeys: {
      type: [String],
      default: [],
      indexed: true,
    },
    jiraIssueKey: {
      type: String,
      default: null,
      indexed: true,
    },
    locked: {
      type: Boolean,
      default: false,
    },
    contributionRatio: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    gitHubHandle: {
      type: String,
      default: null,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'sprint_contributions',
  }
);

// Indexes for efficient querying
contributionRecordSchema.index({ contributionRecordId: 1 });
contributionRecordSchema.index({ sprintId: 1, studentId: 1, groupId: 1 }, { unique: true });
contributionRecordSchema.index({ sprintId: 1, groupId: 1 });
contributionRecordSchema.index({ studentId: 1, sprintId: 1 });

const ContributionRecord = mongoose.model('ContributionRecord', contributionRecordSchema);

module.exports = ContributionRecord;
