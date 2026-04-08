const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getAssignedJuryCommittees } = require('../controllers/committees');

router.get(
  '/committees',
  authMiddleware,
  roleMiddleware(['professor', 'committee_member', 'admin']),
  getAssignedJuryCommittees
);

module.exports = router;
