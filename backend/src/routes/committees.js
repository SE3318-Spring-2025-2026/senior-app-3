const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { validateCommitteeSetup } = require('../controllers/committees');

router.post('/:committeeId/validate', authMiddleware, roleMiddleware(['coordinator']), validateCommitteeSetup);

module.exports = router;