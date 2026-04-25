'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const prValidationSchema = new mongoose.Schema(
  {
    prValidationId: {
      type: String,
      required: true,
      unique: true,
      default: () => `prv_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
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
    prId: {
      type: String,
      required: true,
      index: true,
    },
    prUrl: {
      type: String,
      default: null,
    },
    mergeStatus: {
      type: String,
      enum: ['MERGED', 'NOT_MERGED', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    rawState: {
      type: String,
      default: null,
    },
    validatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'pr_validations',
  }
);

prValidationSchema.index({ groupId: 1, sprintId: 1, issueKey: 1, prId: 1 }, { unique: true });
prValidationSchema.index({ groupId: 1, sprintId: 1, validatedAt: -1 });

module.exports = mongoose.model('PrValidation', prValidationSchema);
