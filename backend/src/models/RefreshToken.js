const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      default: () => `rt_${uuidv4()}`,
      unique: true,
      required: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    rotatedFrom: {
      type: String,
      default: null,
      // References the previous token's tokenId when rotated
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    userAgent: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries and cleanup
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ userId: 1, isRevoked: 1 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;
