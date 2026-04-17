'use strict';

const express = require('express');
const router = express.Router();

const { deliverableAuthMiddleware } = require('../middleware/auth');
const commentsController = require('../controllers/comments');

// All comment routes require a valid JWT
router.use(deliverableAuthMiddleware);

/**
 * POST /api/v1/comments
 * Add a new comment to a deliverable review
 */
router.post('/', commentsController.addComment);

/**
 * GET /api/v1/comments
 * Get paginated list of comments for a deliverable
 */
router.get('/', commentsController.getComments);

/**
 * PATCH /api/v1/comments/:commentId
 * Edit comment content (author only)
 */
router.patch('/:commentId', commentsController.editComment);

/**
 * POST /api/v1/comments/:commentId/reply
 * Add a reply to a comment
 */
router.post('/:commentId/reply', commentsController.addReply);

/**
 * PATCH /api/v1/comments/:commentId/resolve
 * Resolve a comment (coordinator only)
 */
router.patch('/:commentId/resolve', commentsController.resolveComment);

module.exports = router;
