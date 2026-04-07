const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getAuditLogs } = require('../controllers/auditLogs');

// GET /api/v1/audit-logs?group_id=xxx&event_type=xxx
// Read-only. Append-only guarantee: no PUT/PATCH/DELETE routes exist.
router.get('/', authMiddleware, getAuditLogs);

module.exports = router;
