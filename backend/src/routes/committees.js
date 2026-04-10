const express = require('express');
const {
  createCommittee,
  validateCommitteeHandler,
  publishCommitteeHandler,
  assignAdvisorsHandler,
  assignJuryHandler,
} = require('../controllers/committees');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Middleware to enforce coordinator role
const coordinatorOnly = (req, res, next) => {
  if (req.user?.role !== 'coordinator') {
    return res.status(403).json({ error: 'Only coordinators can manage committees' });
  }
  next();
};

// All routes require authentication
router.use(authMiddleware);
router.use(coordinatorOnly);

// Create committee (Process 4.1: Create Committee)
router.post('/', createCommittee);

// Assign advisors to committee (Process 4.2: Assign Advisors)
router.post('/:committeeId/advisors', assignAdvisorsHandler);

// Assign jury members to committee (Process 4.3: Add Jury Members)
router.post('/:committeeId/jury', assignJuryHandler);

// Validate committee setup (Process 4.4: Validate Setup)
router.post('/:committeeId/validate', validateCommitteeHandler);

// Publish committee (Process 4.5: Publish & Notify)
router.post('/:committeeId/publish', publishCommitteeHandler);

module.exports = router;
