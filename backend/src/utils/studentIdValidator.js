/**
 * Validation error codes
 */
const ValidationErrorCodes = {
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_EMAIL_FORMAT: 'INVALID_EMAIL_FORMAT',
  EMPTY_STUDENT_ID: 'EMPTY_STUDENT_ID',
  EMPTY_NAME: 'EMPTY_NAME',
  DUPLICATE_IN_BATCH: 'DUPLICATE_IN_BATCH',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  EMAIL_CONFLICT: 'EMAIL_CONFLICT',
};

/**
 * Check if email is in valid format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate a single row of student ID data
 * Checks: required fields, field format, email format
 * 
 * @param {object} row - Row with studentId, name, email
 * @param {number} rowNumber - CSV line number for error reporting
 * @returns {object} { valid: boolean, error?: { code, message, details } }
 */
function validateRowFormat(row, rowNumber) {
  const { studentid, name, email } = row;

  // Check missing fields
  if (!studentid || studentid.trim() === '') {
    return {
      valid: false,
      error: {
        code: ValidationErrorCodes.EMPTY_STUDENT_ID,
        message: 'Student ID is empty',
        details: 'Student ID field must contain a non-empty value',
      },
    };
  }

  if (!name || name.trim() === '') {
    return {
      valid: false,
      error: {
        code: ValidationErrorCodes.EMPTY_NAME,
        message: 'Name is empty',
        details: 'Name field must contain a non-empty value',
      },
    };
  }

  if (!email || email.trim() === '') {
    return {
      valid: false,
      error: {
        code: ValidationErrorCodes.MISSING_FIELD,
        message: 'Email is empty',
        details: 'Email field must contain a non-empty value',
      },
    };
  }

  // Validate email format
  if (!isValidEmail(email.trim())) {
    return {
      valid: false,
      error: {
        code: ValidationErrorCodes.INVALID_EMAIL_FORMAT,
        message: 'Invalid email format',
        details: `Email "${email}" does not match valid email pattern`,
      },
    };
  }

  return { valid: true };
}

/**
 * Check for duplicate student IDs within the batch
 * 
 * @param {array} rows - Array of rows with { rowNumber, data: { studentid, email, name } }
 * @returns {object} { isValid: boolean, duplicates: array }
 *   duplicates: [{ studentId, rowNumbers: [1, 5] }]
 */
function checkBatchUniqueness(rows) {
  const studentIdMap = {};
  const duplicates = [];

  rows.forEach((row) => {
    const { studentid } = row.data;
    if (!studentIdMap[studentid]) {
      studentIdMap[studentid] = [];
    }
    studentIdMap[studentid].push(row.rowNumber);
  });

  // Find duplicates
  Object.entries(studentIdMap).forEach(([studentId, rowNumbers]) => {
    if (rowNumbers.length > 1) {
      duplicates.push({
        studentId,
        rowNumbers,
      });
    }
  });

  return {
    isValid: duplicates.length === 0,
    duplicates,
  };
}

/**
 * Validate rows against database for conflicts
 * Checks: student ID already registered, email already used
 * 
 * @param {array} rows - Array of rows to check
 * @param {object} StudentIdRegistry - MongoDB model
 * @returns {Promise<object>} { conflicts: [{ rowNumber, studentId, code, message }] }
 */
async function checkDatabaseConflicts(rows, StudentIdRegistry) {
  const conflicts = [];

  // Get all student IDs and emails from this batch for querying
  const studentIds = rows.map((r) => r.data.studentid.trim());
  const emails = rows.map((r) => r.data.email.trim().toLowerCase());

  // Query for existing records
  const existingRecords = await StudentIdRegistry.find({
    $or: [
      { studentId: { $in: studentIds } },
      { email: { $in: emails } },
    ],
  }).exec();

  // Create lookup maps
  const recordByStudentId = {};
  const recordByEmail = {};

  existingRecords.forEach((record) => {
    recordByStudentId[record.studentId] = record;
    recordByEmail[record.email] = record;
  });

  // Check each row for conflicts
  rows.forEach((row) => {
    const { studentid, email } = row.data;
    const existingByStudentId = recordByStudentId[studentid];
    const existingByEmail = recordByEmail[email.toLowerCase()];

    // If student ID exists with different email -> conflict
    if (existingByStudentId && existingByStudentId.email !== email.toLowerCase()) {
      conflicts.push({
        rowNumber: row.rowNumber,
        studentId: studentid,
        code: ValidationErrorCodes.EMAIL_CONFLICT,
        message: 'Email already registered to a different student ID',
        details: `This email is already associated with student ID: ${existingByStudentId.studentId}`,
      });
    }

    // If email exists with different student ID -> conflict
    if (existingByEmail && existingByEmail.studentId !== studentid) {
      conflicts.push({
        rowNumber: row.rowNumber,
        studentId: studentid,
        code: ValidationErrorCodes.ALREADY_REGISTERED,
        message: 'Student ID already registered',
        details: `This student ID is already registered with email: ${existingByEmail.email}`,
      });
    }
  });

  return { conflicts };
}

/**
 * Comprehensive validation pipeline for CSV rows
 * 
 * @param {array} rows - Array of parsed CSV rows
 * @param {object} StudentIdRegistry - MongoDB model
 * @returns {Promise<object>} { validRows, invalidRows }
 *   validRows: [{ rowNumber, data: {...} }]
 *   invalidRows: [{ rowNumber, studentId, reason, details }]
 */
async function validateBatch(rows, StudentIdRegistry) {
  const invalidRows = [];
  const validRowsForConflictCheck = [];
  const rowsByNumber = {};

  // Step 1: Validate format of each row
  rows.forEach((row) => {
    rowsByNumber[row.rowNumber] = row;
    const formatCheck = validateRowFormat(row.data, row.rowNumber);

    if (!formatCheck.valid) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        studentId: row.data.studentid || 'UNKNOWN',
        reason: formatCheck.error.message,
        details: formatCheck.error.details,
      });
    } else {
      validRowsForConflictCheck.push(row);
    }
  });

  // Step 2: Check for duplicates within batch
  const batchUniquenessCheck = checkBatchUniqueness(validRowsForConflictCheck);
  if (!batchUniquenessCheck.isValid) {
    batchUniquenessCheck.duplicates.forEach((dup) => {
      dup.rowNumbers.forEach((rowNum) => {
        const row = rowsByNumber[rowNum];
        invalidRows.push({
          rowNumber: rowNum,
          studentId: dup.studentId,
          reason: 'Duplicate student ID in batch',
          details: `This student ID appears in rows: ${dup.rowNumbers.join(', ')}`,
        });
      });
    });

    // Remove duplicates from valid rows for DB check
    const duplicateStudentIds = new Set(batchUniquenessCheck.duplicates.map((d) => d.studentId));
    validRowsForConflictCheck = validRowsForConflictCheck.filter(
      (row) => !duplicateStudentIds.has(row.data.studentid.trim())
    );
  }

  // Step 3: Check for database conflicts
  if (validRowsForConflictCheck.length > 0) {
    const dbConflictCheck = await checkDatabaseConflicts(validRowsForConflictCheck, StudentIdRegistry);
    if (dbConflictCheck.conflicts.length > 0) {
      dbConflictCheck.conflicts.forEach((conflict) => {
        invalidRows.push({
          rowNumber: conflict.rowNumber,
          studentId: conflict.studentId,
          reason: conflict.message,
          details: conflict.details,
        });
      });

      // Remove DB conflicts from valid rows
      const conflictRowNumbers = new Set(dbConflictCheck.conflicts.map((c) => c.rowNumber));
      validRowsForConflictCheck = validRowsForConflictCheck.filter(
        (row) => !conflictRowNumbers.has(row.rowNumber)
      );
    }
  }

  return {
    validRows: validRowsForConflictCheck,
    invalidRows,
  };
}

module.exports = {
  ValidationErrorCodes,
  validateRowFormat,
  checkBatchUniqueness,
  checkDatabaseConflicts,
  validateBatch,
  isValidEmail,
};
