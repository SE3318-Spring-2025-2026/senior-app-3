const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { committeeLimiter } = require('../middleware/committeeLimiter');
const {
  createCommittee,
  listCommittees,
  getCommittee,
} = require('../controllers/committeeController');

// POST /api/v1/committees
// Process 4.1: Coordinator creates a committee draft → forwarded to 4.2 (f01, f02)
// Rate limited: max 10 requests per coordinator per 15-minute window
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator']),
  committeeLimiter,
  createCommittee
);

// GET /api/v1/committees
// List all committees (Coordinator / Admin)
router.get(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  listCommittees
);

// GET /api/v1/committees/:committeeId
// Retrieve a single committee record from D3
router.get(
  '/:committeeId',
  authMiddleware,
  roleMiddleware(['coordinator', 'admin']),
  getCommittee
);

module.exports = router;
