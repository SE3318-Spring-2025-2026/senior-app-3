const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getActiveWindow, createWindow, deactivateWindow } = require('../controllers/scheduleWindow');

// GET /api/v1/schedule-window/active — anyone authenticated can check if creation is open
router.get('/active', authMiddleware, getActiveWindow);

// POST /api/v1/schedule-window — coordinator/admin defines a new window
router.post('/', authMiddleware, roleMiddleware(['coordinator', 'admin']), createWindow);

// DELETE /api/v1/schedule-window/:windowId — coordinator/admin deactivates a window
router.delete('/:windowId', authMiddleware, roleMiddleware(['coordinator', 'admin']), deactivateWindow);

module.exports = router;
