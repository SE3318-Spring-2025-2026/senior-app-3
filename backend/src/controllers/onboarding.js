const crypto = require('crypto');
const StudentIdRegistry = require('../models/StudentIdRegistry');
const StudentIdUploadBatch = require('../models/StudentIdUploadBatch');
const User = require('../models/User');
const { parseCSV } = require('../utils/csvParser');
const { validateBatch } = require('../utils/studentIdValidator');
const { sendVerificationEmail, sendAccountReadyEmail } = require('../services/emailService');
const { createAuditLog } = require('../services/auditService');

/**
 * Upload and process student ID CSV file
 * POST /onboarding/upload-student-ids
 */
const uploadStudentIds = async (req, res) => {
  try {
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

    let fileHash;
    try {
      fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      return res.status(500).json({ code: 'HASH_ERROR', message: 'Failed to process file' });
    }

    const existingBatch = await StudentIdUploadBatch.findOne({ fileHash });
    if (existingBatch) {
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

    let parsedRows;
    try {
      const { Readable } = require('stream');
      const fileStream = Readable.from([fileBuffer]);
      parsedRows = await parseCSV(fileStream);
    } catch (error) {
      return res.status(400).json({
        code: 'CSV_PARSE_ERROR',
        message: 'Failed to parse CSV file',
        details: error.message,
      });
    }

    if (parsedRows.length === 0) {
      return res.status(400).json({
        code: 'EMPTY_CSV',
        message: 'CSV file contains no data rows',
      });
    }

    let validRows, invalidRows;
    try {
      const validationResult = await validateBatch(parsedRows, StudentIdRegistry);
      validRows = validationResult.validRows;
      invalidRows = validationResult.invalidRows;
    } catch (error) {
      return res.status(500).json({
        code: 'VALIDATION_ERROR',
        message: 'Failed to validate student IDs',
        details: error.message,
      });
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (const row of validRows) {
      const { studentid, name, email } = row.data;
      const existingRecord = await StudentIdRegistry.findOne({ studentId: studentid.trim() });

      if (existingRecord) {
        existingRecord.name = name.trim();
        existingRecord.email = email.trim().toLowerCase();
        existingRecord.status = 'valid';
        existingRecord.uploadBatchId = 'temp';
        existingRecord.updatedByBatchId = 'temp';
        await existingRecord.save();
        updatedCount++;
      } else {
        const newRecord = new StudentIdRegistry({
          studentId: studentid.trim(),
          name: name.trim(),
          email: email.trim().toLowerCase(),
          status: 'valid',
          uploadBatchId: 'temp',
        });
        await newRecord.save();
        insertedCount++;
      }
    }

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

    await newBatch.save();

    await StudentIdRegistry.updateMany(
      { uploadBatchId: 'temp' },
      { uploadBatchId: newBatch.batchId },
      { multi: true }
    );

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
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to process student ID upload' });
  }
};

/**
 * Validate student ID for registration
 * POST /onboarding/validate-student-id
 */
const validateStudentId = async (req, res) => {
  try {
    const { studentId, email } = req.body;

    if (!studentId || !email) {
      return res.status(400).json({
        code: 'MISSING_FIELDS',
        message: 'Student ID and email are required',
      });
    }

    // Check if student ID exists in registry
    const registeredStudent = await StudentIdRegistry.findOne({
      studentId: studentId.trim(),
      status: 'valid',
    });

    if (!registeredStudent) {
      return res.status(422).json({
        valid: false,
        reason: 'Student ID not found in records. Please verify your ID and try again.',
        code: 'INVALID_STUDENT_ID',
      });
    }

    // Check email matches
    if (registeredStudent.email !== email.trim().toLowerCase()) {
      return res.status(422).json({
        valid: false,
        reason: 'Email address does not match the registered student ID. Please use the email associated with your enrollment.',
        code: 'EMAIL_MISMATCH',
      });
    }

    // Check if this student ID has already been registered
    const existingUser = await User.findOne({ studentId: studentId.trim() });
    if (existingUser) {
      return res.status(422).json({
        valid: false,
        reason: 'This student ID has already been registered. If you forgot your password, please use the password reset option.',
        code: 'DUPLICATE_REGISTRATION',
      });
    }

    // Check if this email has already been registered
    const existingEmailUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingEmailUser) {
      return res.status(422).json({
        valid: false,
        reason: 'An account with this email address already exists. Please sign in or use a different email.',
        code: 'EMAIL_ALREADY_REGISTERED',
      });
    }

    // Generate validation token
    const jwt = require('jsonwebtoken');
    const validationPayload = {
      studentId: studentId.trim(),
      email: email.trim().toLowerCase(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600, // 10 minutes expiry
      type: 'student_id_validation',
    };

    const validationToken = jwt.sign(validationPayload, process.env.JWT_SECRET || 'your-secret-key', {
      algorithm: 'HS256',
    });

    return res.status(200).json({
      valid: true,
      validationToken,
      expiresIn: 600,
      message: 'Student ID validated successfully',
    });
  } catch (error) {
    console.error('Validate student ID error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to validate student ID',
      valid: false,
    });
  }
};

const RESEND_COOLDOWN_MS = 60 * 1000;       // 1 minute between resends
const MAX_EMAILS_PER_24H = 5;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Send email verification link
 * POST /onboarding/send-verification-email
 */
const sendVerificationEmailHandler = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: 'userId is required' });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(200).json({ code: 'ALREADY_VERIFIED', messageId: 'already-verified', recipient: user.email, status: 'sent' });
    }

    const now = new Date();

    // Rate limit: 1 per minute
    if (user.emailVerificationLastSentAt) {
      const elapsed = now - user.emailVerificationLastSentAt;
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          code: 'RATE_LIMITED',
          message: 'Please wait before requesting another verification email',
          retryAfter,
        });
      }
    }

    // Rate limit: max 5 per 24h window
    const windowExpired = !user.emailVerificationWindowStart ||
      (now - user.emailVerificationWindowStart) >= WINDOW_24H_MS;

    if (windowExpired) {
      user.emailVerificationSentCount = 0;
      user.emailVerificationWindowStart = now;
    }

    if (user.emailVerificationSentCount >= MAX_EMAILS_PER_24H) {
      const retryAfter = Math.ceil((WINDOW_24H_MS - (now - user.emailVerificationWindowStart)) / 1000);
      return res.status(429).json({
        code: 'MAX_EMAILS_REACHED',
        message: 'Maximum verification emails reached for today. Please try again tomorrow.',
        retryAfter,
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationTokenExpiry = new Date(now.getTime() + WINDOW_24H_MS);
    user.emailVerificationLastSentAt = now;
    user.emailVerificationSentCount += 1;
    await user.save();

    const result = await sendVerificationEmail(user.email, token, user.userId);

    return res.status(200).json({ ...result, retryAfter: Math.ceil(RESEND_COOLDOWN_MS / 1000) });
  } catch (error) {
    console.error('Send verification email error:', error);
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to send verification email' });
  }
};

/**
 * Confirm email verification token
 * POST /onboarding/verify-email
 */
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: 'token is required' });
    }

    // Find by token first (without expiry check) to distinguish invalid vs expired
    const user = await User.findOne({ emailVerificationToken: token });

    if (!user) {
      return res.status(400).json({
        code: 'INVALID_TOKEN',
        message: 'Verification token is invalid',
      });
    }

    if (user.emailVerified) {
      return res.status(200).json({
        code: 'ALREADY_VERIFIED',
        userId: user.userId,
        emailVerified: true,
        accountStatus: user.accountStatus,
      });
    }

    if (user.emailVerificationTokenExpiry < new Date()) {
      return res.status(400).json({
        code: 'EXPIRED_TOKEN',
        message: 'Verification token has expired. Please request a new one.',
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;
    await user.save();

    return res.status(200).json({
      userId: user.userId,
      emailVerified: true,
      accountStatus: user.accountStatus,
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to verify email' });
  }
};

/**
 * Finalise onboarding — mark account active and send account-ready email
 * POST /onboarding/complete
 */
const completeOnboarding = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: 'userId is required' });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    }

    if (!user.emailVerified) {
      return res.status(400).json({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email must be verified before completing onboarding',
      });
    }

    user.accountStatus = 'active';
    await user.save();

    await sendAccountReadyEmail(user.email, user.role, user.userId);

    return res.status(200).json({
      userId: user.userId,
      email: user.email,
      role: user.role,
      githubUsername: user.githubUsername || null,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to complete onboarding' });
  }
};

/**
 * Get user account record
 * GET /onboarding/accounts/:userId
 * Access: owner or admin
 */
const getAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUser = req.user;

    const isOwner = requestingUser.userId === userId;
    const isAdmin = requestingUser.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    }

    // Audit: account record accessed
    await createAuditLog({
      action: 'ACCOUNT_RETRIEVED',
      actorId: requestingUser.userId,
      targetId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      userId: user.userId,
      email: user.email,
      role: user.role,
      githubUsername: user.githubUsername || null,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Get account error:', error);
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to get account' });
  }
};

/**
 * Update user account record
 * PATCH /onboarding/accounts/:userId
 *
 * Access / field rules:
 *   - Owner (self):  may update githubUsername only
 *   - Admin:         may update githubUsername, emailVerified, accountStatus
 *   - Neither role can update `role` through this endpoint
 */
const updateAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUser = req.user;

    const isOwner = requestingUser.userId === userId;
    const isAdmin = requestingUser.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    // Block role updates for everyone through this endpoint
    if (req.body.role !== undefined) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Role cannot be updated through this endpoint',
      });
    }

    // Determine permitted fields by requester's privilege level
    const allowedFields = isAdmin
      ? ['githubUsername', 'emailVerified', 'accountStatus']
      : ['githubUsername'];

    // Non-admin trying to touch a privileged field
    if (!isAdmin) {
      const privilegedFields = ['emailVerified', 'accountStatus'];
      for (const field of privilegedFields) {
        if (req.body[field] !== undefined) {
          return res.status(403).json({
            code: 'FORBIDDEN',
            message: `Only admins may update '${field}'`,
          });
        }
      }
    }

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ code: 'NO_CHANGES', message: 'No valid fields to update' });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    }

    // Capture previous values before applying changes
    const previousValues = {};
    const newValues = {};
    for (const field of Object.keys(updates)) {
      previousValues[field] = user[field];
      newValues[field] = updates[field];
      user[field] = updates[field];
    }

    await user.save();

    // Best-effort audit log: failure here must not fail the update response
    try {
      await createAuditLog({
        action: 'ACCOUNT_UPDATED',
        actorId: requestingUser.userId,
        targetId: userId,
        changes: { previous: previousValues, updated: newValues },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed for ACCOUNT_UPDATED (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      userId: user.userId,
      email: user.email,
      role: user.role,
      githubUsername: user.githubUsername || null,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Update account error:', error);
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to update account' });
  }
};

module.exports = {
  uploadStudentIds,
  validateStudentId,
  sendVerificationEmailHandler,
  verifyEmail,
  completeOnboarding,
  getAccount,
  updateAccount,
};
