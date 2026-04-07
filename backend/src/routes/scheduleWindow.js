const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getActiveWindow, getAllWindows, createWindow, deactivateWindow } = require('../controllers/scheduleWindow');

// GET /api/v1/schedule-window/active — check if a window is open (?type=group_creation|member_addition)
router.get('/active', authMiddleware, getActiveWindow);

// GET /api/v1/schedule-window — coordinator/admin lists all windows (?type=... optional filter)
router.get('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), getAllWindows);

// POST /api/v1/schedule-window — coordinator/admin creates a new window
router.post('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), createWindow);

// DELETE /api/v1/schedule-window/:windowId — coordinator/admin deactivates a window
router.delete('/:windowId', authMiddleware, roleMiddleware(['coordinator', 'admin']), deactivateWindow);

module.exports = router;
