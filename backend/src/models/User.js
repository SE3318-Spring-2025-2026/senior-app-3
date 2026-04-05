const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: () => `usr_${uuidv4().split('-')[0]}`,
      unique: true,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    hashedPassword: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['student', 'professor', 'admin', 'committee_member', 'coordinator'],
      default: 'student',
    },
    githubUsername: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      // Note: Unique constraint enforced via sparse index in migration 002
      // Do not add unique: true here - it conflicts with sparse index
    },
    githubId: {
      type: String,
      default: null,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    accountStatus: {
      type: String,
      enum: ['pending', 'pending_verification', 'active', 'suspended'],
      default: 'pending_verification',
    },
    studentId: {
      type: String,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    emailVerificationToken: {
      type: String,
      default: null,
    },
    emailVerificationTokenExpiry: {
      type: Date,
      default: null,
    },
    emailVerificationSentCount: {
      type: Number,
      default: 0,
    },
    emailVerificationWindowStart: {
      type: Date,
      default: null,
    },
    emailVerificationLastSentAt: {
      type: Date,
      default: null,
    },
    passwordResetToken: {
      type: String,
      default: null,
    },
    passwordResetTokenExpiry: {
      type: Date,
      default: null,
    },
    passwordResetSentCount: {
      type: Number,
      default: 0,
    },
    passwordResetWindowStart: {
      type: Date,
      default: null,
    },
    requiresPasswordChange: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries (email and userId indexes are created automatically via unique: true on the field)
userSchema.index({ githubId: 1 });
// Note: githubUsername sparse unique index created in migration 002

const User = mongoose.model('User', userSchema);

module.exports = User;
