'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB

const ACCEPTED_MIMETYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'application/zip',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const stagingId = uuidv4();
    req.stagingId = stagingId;
    const dest = path.join('uploads', 'staging', stagingId);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ACCEPTED_MIMETYPES.has(file.mimetype)) {
    const err = new multer.MulterError('UNSUPPORTED_MEDIA_TYPE');
    err.message = `Unsupported file type: ${file.mimetype}`;
    err.status = 415;
    return cb(err, false);
  }
  cb(null, true);
};

const multerInstance = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * Returns a middleware that parses a single uploaded file from the given field name.
 * Responds with 413 if file exceeds 1 GB, 415 if MIME type is not accepted.
 * Both error responses are sent before the controller runs.
 *
 * @param {string} fieldName - Form field name for the uploaded file
 * @returns {Function} Express middleware
 */
const uploadSingle = (fieldName) => (req, res, next) => {
  multerInstance.single(fieldName)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          code: 'FILE_TOO_LARGE',
          message: 'File exceeds the maximum allowed size of 1 GB',
        });
      }
      if (err.code === 'UNSUPPORTED_MEDIA_TYPE' || err.status === 415) {
        return res.status(415).json({
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: err.message || 'File type is not supported',
        });
      }
    }

    // Non-multer errors (e.g. filesystem errors)
    next(err);
  });
};

module.exports = { uploadSingle };
