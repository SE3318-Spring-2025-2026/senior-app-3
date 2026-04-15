'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Comment Schema (unified comment/reply thread)
 *
 * Covers general comments, clarification requests, and threaded replies in a
 * single collection. Each top-level document is one comment; replies are stored
 * as an embedded array to avoid extra round-trips for the common read path.
 *
 * Process 6 — Review & Comment workflow.
 */
const replySchema = new mongoose.Schema(
  {
    replyId: {
      type: String,
      default: () => `rpl_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
      required: true,
    },
    authorId: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 2000,
    },
    createdAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema(
  {
    commentId: {
      type: String,
      default: () => `cmt_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
      unique: true,
      required: true,
      index: true,
    },
    deliverableId: {
      type: String,
      required: true,
      ref: 'Deliverable',
    },
    authorId: {
      type: String,
      required: true,
    },
    authorName: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 5000,
    },
    commentType: {
      type: String,
      enum: ['general', 'question', 'clarification_required', 'suggestion', 'praise'],
      default: 'general',
    },
    sectionNumber: {
      type: Number,
      default: null,
    },
    needsResponse: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['open', 'resolved', 'acknowledged'],
      default: 'open',
    },
    replies: {
      type: [replySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'comments',
  }
);

commentSchema.index({ deliverableId: 1, createdAt: 1 });
commentSchema.index({ deliverableId: 1, status: 1 });

module.exports = mongoose.model('Comment', commentSchema);
