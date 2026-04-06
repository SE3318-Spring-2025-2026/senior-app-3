const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * SyncErrorLog — records failed external API sync attempts.
 *
 * Written when an external API (GitHub, JIRA, Notification Service)
 * fails after all retry attempts. Used by the retry logic test to
 * confirm a sync error entry is persisted after 3 consecutive failures.
 */
const syncErrorLogSchema = new mongoose.Schema(
  {
    errorId: {
      type: String,
      default: () => `ser_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    service: {
      type: String,
      enum: ['github', 'jira', 'notification'],
      required: true,
    },
    groupId: { type: String, required: true },
    actorId: { type: String, required: true },
    attempts: { type: Number, default: 3 },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

syncErrorLogSchema.index({ groupId: 1, service: 1 });

module.exports = mongoose.model('SyncErrorLog', syncErrorLogSchema);
