const express = require('express');
const router = express.Router();
const advisorRequestController = require('../controllers/advisorRequestController');
const { authMiddleware } = require('../middleware/auth');

/**
 * POST /api/v1/advisor-requests
 * Submit a new advisor request (Process 3.1)
 */
router.post('/', authMiddleware, advisorRequestController.createRequest);

module.exports = router;
