const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { createCommittee, getCommittee, publishCommittee } = require('../controllers/committees');

// Process 4.1 draft write path
router.post('/', authMiddleware, roleMiddleware(['coordinator']), createCommittee);

// Process 4.4 read path support
router.get('/:committeeId', authMiddleware, getCommittee);

// Process 4.5 publish write path
router.post('/:committeeId/publish', authMiddleware, roleMiddleware(['coordinator']), publishCommittee);

module.exports = router;
