const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const {
  createCommittee,
  listCommittees,
  getCommittee,
  assignCommitteeAdvisors,
  addJuryMembers,
} = require('../controllers/committeeController');

// POST /api/v1/committees
// Process 4.1: Coordinator creates a committee draft → forwarded to 4.2 (f01, f02)
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['coordinator']),
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

// POST /api/v1/committees/:committeeId/advisors
// Process 4.2: Assign advisors to committee
router.post(
  '/:committeeId/advisors',
  authMiddleware,
  roleMiddleware(['coordinator']),
  assignCommitteeAdvisors
);

// POST /api/v1/committees/:committeeId/jury
// Process 4.3: Add jury members to committee
router.post(
  '/:committeeId/jury',
  authMiddleware,
  roleMiddleware(['coordinator']),
  addJuryMembers
);

module.exports = router;
