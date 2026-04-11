const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getMyRequests, decideOnRequest } = require('../controllers/advisorRequests');

router.get(
  '/mine',
  authMiddleware,
  roleMiddleware(['professor', 'advisor']),
  getMyRequests
);

router.patch(
  '/:requestId',
  authMiddleware,
  roleMiddleware(['professor', 'advisor']),
  decideOnRequest
);

module.exports = router;
