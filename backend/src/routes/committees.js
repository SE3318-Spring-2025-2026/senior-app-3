const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const {
  createCommittee,
  listCommittees,
  listCommitteeCandidates,
  assignCommitteeAdvisors,
  addCommitteeJuryMembers,
  validateCommitteeSetup,
  publishCommittee,
} = require('../controllers/committees');

router.get('/candidates', authMiddleware, roleMiddleware(['coordinator', 'admin']), listCommitteeCandidates);
router.get('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), listCommittees);
router.post('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), createCommittee);
router.post('/:committeeId/advisors', authMiddleware, roleMiddleware(['coordinator', 'admin']), assignCommitteeAdvisors);
router.post('/:committeeId/jury', authMiddleware, roleMiddleware(['coordinator', 'admin']), addCommitteeJuryMembers);
router.post('/:committeeId/validate', authMiddleware, roleMiddleware(['coordinator', 'admin']), validateCommitteeSetup);
router.post('/:committeeId/publish', authMiddleware, roleMiddleware(['coordinator', 'admin']), publishCommittee);

module.exports = router;
