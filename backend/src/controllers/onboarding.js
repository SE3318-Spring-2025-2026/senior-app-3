const StudentIdRegistry = require('../models/StudentIdRegistry');
const StudentIdUploadBatch = require('../models/StudentIdUploadBatch');
const { parseCSV } = require('../utils/csvParser');
const { hashFileStream } = require('../utils/fileHash');
const { validateBatch } = require('../utils/studentIdValidator');
const { generateTokenPair } = require('../utils/jwt');

/**
 * Upload and process student ID CSV file
 * POST /onboarding/upload-student-ids
 * 
 * Request: multipart/form-data with file
 * Response: 200 {status, batch, summary, rejectedRows}
 */
const uploadStudentIds = async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        code: 'NO_FILE',
        message: 'No CSV file provided',
        details: 'Please upload a CSV file with student IDs',
      });
    }

    const coordinatorId = req.user.userId;
    const fileName = req.file.originalname;
    const fileBuffer = req.file.buffer;

    // Step 1: Compute file hash to detect re-uploads (idempotency)
    let fileHash;
    try {
      const crypto = require('crypto');
      fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      console.error('File hash error:', error);
      return res.status(500).json({
        code: 'HASH_ERROR',
        message: 'Failed to process file',
      });
    }

    // Check if this file was already uploaded
    const existingBatch = await StudentIdUploadBatch.findOne({ fileHash });
    if (existingBatch) {
      // File already processed - return idempotent response with previous counts
      return res.status(200).json({
        status: 'success',
        message: 'File already processed (idempotent re-upload)',
        batch: {
          batchId: existingBatch.batchId,
          uploadedAt: existingBatch.uploadedAt,
          fileHash: existingBatch.fileHash,
          isDuplicate: true,
        },
        summary: {
          total: existingBatch.totalRecords,
          inserted: existingBatch.insertedCount,
          updated: existingBatch.updatedCount,
          rejected: existingBatch.rejectedCount,
        },
        rejectedRows: existingBatch.rejectedRows,
      });
    }

    // Step 2: Parse CSV file
    let parsedRows;
    try {
      const { Readable } = require('stream');
      const fileStream = Readable.from([fileBuffer]);
      parsedRows = await parseCSV(fileStream);
    } catch (error) {
      console.error('CSV parse error:', error);
      return res.status(400).json({
        code: 'CSV_PARSE_ERROR',
        message: 'Failed to parse CSV file',
        details: error.message,
      });
    }

    // Check for empty CSV
    if (parsedRows.length === 0) {
      return res.status(400).json({
        code: 'EMPTY_CSV',
        message: 'CSV file contains no data rows',
        details: 'Please provide a CSV file with at least one student record',
      });
    }

    // Step 3: Validate all rows
    let validRows, invalidRows;
    try {
      const validationResult = await validateBatch(parsedRows, StudentIdRegistry);
      validRows = validationResult.validRows;
      invalidRows = validationResult.invalidRows;
    } catch (error) {
      console.error('Batch validation error:', error);
      return res.status(500).json({
        code: 'VALIDATION_ERROR',
        message: 'Failed to validate student IDs',
        details: error.message,
      });
    }

    // Step 4: Upsert valid rows into database
    let insertedCount = 0;
    let updatedCount = 0;

    try {
      for (const row of validRows) {
        const { studentid, name, email } = row.data;

        // Try to find existing record
        const existingRecord = await StudentIdRegistry.findOne({
          studentId: studentid.trim(),
        });

        if (existingRecord) {
          // Update existing record
          existingRecord.name = name.trim();
          existingRecord.email = email.trim().toLowerCase();
          existingRecord.status = 'valid';
          existingRecord.uploadBatchId = 'temp'; // Will be set after batch is created
          existingRecord.updatedByBatchId = 'temp';
          await existingRecord.save();
          updatedCount++;
        } else {
          // Create new record
          const newRecord = new StudentIdRegistry({
            studentId: studentid.trim(),
            name: name.trim(),
            email: email.trim().toLowerCase(),
            status: 'valid',
            uploadBatchId: 'temp', // Will be set after batch is created
          });
          await newRecord.save();
          insertedCount++;
        }
      }
    } catch (error) {
      console.error('Database upsert error:', error);
      return res.status(500).json({
        code: 'DATABASE_ERROR',
        message: 'Failed to save student IDs to database',
        details: error.message,
      });
    }

    // Step 5: Create upload batch record for audit trail
    const newBatch = new StudentIdUploadBatch({
      fileHash,
      coordinatorId,
      fileName,
      totalRecords: parsedRows.length,
      insertedCount,
      updatedCount,
      rejectedCount: invalidRows.length,
      rejectedRows: invalidRows,
      uploadedAt: new Date(),
    });

    try {
      await newBatch.save();
    } catch (error) {
      console.error('Batch creation error:', error);
      return res.status(500).json({
        code: 'BATCH_ERROR',
        message: 'Failed to record upload batch',
        details: error.message,
      });
    }

    // Step 6: Update student records with correct batch ID
    try {
      await StudentIdRegistry.updateMany(
        { uploadBatchId: 'temp' },
        { uploadBatchId: newBatch.batchId },
        { multi: true }
      );
    } catch (error) {
      console.error('Batch ID update error:', error);
      // Log but don't fail - batch record was created
    }

    // Return success response
    res.status(200).json({
      status: 'success',
      batch: {
        batchId: newBatch.batchId,
        uploadedAt: newBatch.uploadedAt,
        fileHash: newBatch.fileHash,
      },
      summary: {
        total: parsedRows.length,
        inserted: insertedCount,
        updated: updatedCount,
        rejected: invalidRows.length,
      },
      rejectedRows: invalidRows.length > 0 ? invalidRows : [],
    });
  } catch (error) {
    console.error('Upload student IDs error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to process student ID upload',
      details: error.message,
    });
  }
};

/**
 * Validate student ID for registration
 * POST /onboarding/validate-student-id
 * 
 * Request: {studentId, email, password}
 * Response: 200 {valid: true, validationToken} or 422 {valid: false, reason}
 */
const validateStudentId = async (req, res) => {
  try {
    const { studentId, email, password } = req.body;

    // Input validation
    if (!studentId || !email || !password) {
      return res.status(400).json({
        code: 'MISSING_FIELDS',
        message: 'Student ID, email, and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        code: 'INVALID_PASSWORD',
        message: 'Password must be at least 8 characters',
      });
    }

    // Query student ID registry
    const registeredStudent = await StudentIdRegistry.findOne({
      studentId: studentId.trim(),
      status: 'valid',
    });

    if (!registeredStudent) {
      return res.status(422).json({
        valid: false,
        reason: 'Student ID not recognised',
      });
    }

    // Verify email matches
    if (registeredStudent.email !== email.trim().toLowerCase()) {
      return res.status(422).json({
        valid: false,
        reason: 'Email does not match registered student ID',
      });
    }

    // Generate validation token (short-lived, 10 minutes)
    const validationPayload = {
      studentId: studentId.trim(),
      email: email.trim().toLowerCase(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      type: 'student_id_validation',
    };

    const jwt = require('jsonwebtoken');
    const validationToken = jwt.sign(validationPayload, process.env.JWT_SECRET || 'your-secret-key', {
      algorithm: 'HS256',
    });

    return res.status(200).json({
      valid: true,
      validationToken,
      expiresIn: 600, // 10 minutes in seconds
    });
  } catch (error) {
    console.error('Validate student ID error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to validate student ID',
    });
  }
};

module.exports = {
  uploadStudentIds,
  validateStudentId,
};
