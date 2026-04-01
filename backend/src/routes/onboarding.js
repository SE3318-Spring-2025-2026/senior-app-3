const express = require('express');
const multer = require('multer');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { uploadStudentIds, validateStudentId } = require('../controllers/onboarding');

const router = express.Router();

// Configure multer for file uploads (CSV only, max 50MB)
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    // Accept CSV files
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// Public routes
router.post('/validate-student-id', validateStudentId);

// Protected routes (coordinator/admin only)
router.post(
  '/upload-student-ids',
  authMiddleware,
  roleMiddleware(['admin', 'coordinator']),
  upload.single('file'),
  uploadStudentIds
);

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds maximum size of 50MB',
      });
    }
    return res.status(400).json({
      code: 'FILE_ERROR',
      message: err.message,
    });
  }
  if (err) {
    return res.status(400).json({
      code: 'UPLOAD_ERROR',
      message: err.message,
    });
  }
  next();
});

module.exports = router;
