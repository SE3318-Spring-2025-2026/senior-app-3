const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getActiveWindow, listWindows, createWindow, deactivateWindow } = require('../controllers/scheduleWindow');

// GET /api/v1/schedule-window/active?operationType=group_creation|member_addition
// Anyone authenticated can check if a window is currently open
router.get('/active', authMiddleware, getActiveWindow);

// GET /api/v1/schedule-window — coordinator/admin lists all schedule windows
router.get('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), listWindows);

// POST /api/v1/schedule-window — coordinator/admin defines a new window
router.post('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), createWindow);

// DELETE /api/v1/schedule-window/:windowId — coordinator/admin deactivates a window
router.delete('/:windowId', authMiddleware, roleMiddleware(['coordinator', 'admin']), deactivateWindow);

module.exports = router;
