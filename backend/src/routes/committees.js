const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getAllCommittees, getCommittee, addJuryMembers } = require('../controllers/committees');

router.get('/', authMiddleware, roleMiddleware(['coordinator']), getAllCommittees);
router.get('/:committeeId', authMiddleware, roleMiddleware(['coordinator']), getCommittee);
router.post('/:committeeId/jury', authMiddleware, roleMiddleware(['coordinator']), addJuryMembers);

module.exports = router;
