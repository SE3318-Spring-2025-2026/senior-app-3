const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { createGroup, getGroup } = require('../controllers/groups');

// POST /api/v1/groups — Process 2.1 + 2.2: create, validate, persist, forward to 2.5
router.post('/', authMiddleware, createGroup);

// GET /api/v1/groups/:groupId — Process 2.2: retrieve validated group record from D2
router.get('/:groupId', authMiddleware, getGroup);

module.exports = router;
