'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Deliverable = require('../models/Deliverable');
const DeliverableStaging = require('../models/DeliverableStaging');

/**
 * Custom error class for storage operations
 */
class StorageError extends Error {
  constructor(message, status = 500, code = 'STORAGE_ERROR') {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Calculate SHA256 checksum of file content
 * @param {Buffer|string} content - File content
 * @returns {string} SHA256 hex digest
 */
const calculateChecksum = (content) => {
  return crypto.createHash('sha256').update(content).digest('hex');
};

/**
 * Map staging deliverable types to deliverable types
 * Staging: 'proposal', 'statement_of_work', 'demo', 'interim_report', 'final_report'
 * Deliverable: 'proposal', 'statement-of-work', 'demonstration'
 * @param {string} stagingType - Staging deliverable type
 * @returns {string} Mapped deliverable type
 */
const mapDeliverableType = (stagingType) => {
  const typeMap = {
    'proposal': 'proposal',
    'statement_of_work': 'statement-of-work',
    'demo': 'demonstration',
    'interim_report': 'demonstration',
    'final_report': 'demonstration',
  };
  return typeMap[stagingType] || stagingType;
};

/**
 * Verify file checksum matches staging record
 * @param {string} filePath - Path to file
 * @param {string} expectedHash - Expected SHA256 hash from staging record
 * @throws {StorageError} If checksum mismatch
 */
const verifyChecksum = (filePath, expectedHash) => {
  if (!fs.existsSync(filePath)) {
    throw new StorageError(
      `File not found: ${filePath}`,
      404,
      'FILE_NOT_FOUND'
    );
  }

  const content = fs.readFileSync(filePath);
  const currentHash = calculateChecksum(content);

  if (currentHash !== expectedHash) {
    throw new StorageError(
      'File checksum mismatch - file may be corrupted',
      400,
      'CHECKSUM_MISMATCH'
    );
  }
};

/**
 * Move file from staging directory to permanent storage
 * @param {string} stagingPath - Source staging file path
 * @param {string} permanentDir - Destination permanent directory
 * @param {string} stagingId - Staging record ID for unique naming
 * @returns {string} Final permanent file path
 * @throws {StorageError} If file operation fails (e.g., disk full = 507)
 */
const moveFileToPermanentStorage = (stagingPath, permanentDir, stagingId) => {
  try {
    if (!fs.existsSync(stagingPath)) {
      throw new StorageError(
        `Staging file not found: ${stagingPath}`,
        404,
        'STAGING_FILE_NOT_FOUND'
      );
    }

    // Read file content
    let content;
    try {
      content = fs.readFileSync(stagingPath);
    } catch (err) {
      throw new StorageError(
        `Failed to read staging file: ${err.message}`,
        500,
        'FILE_READ_ERROR'
      );
    }

    // Generate unique permanent path
    const permanentPath = path.join(
      permanentDir,
      `${stagingId}_${Date.now()}.pdf`
    );

    // Ensure permanent directory exists
    if (!fs.existsSync(permanentDir)) {
      try {
        fs.mkdirSync(permanentDir, { recursive: true });
      } catch (err) {
        throw new StorageError(
          `Failed to create permanent directory: ${err.message}`,
          500,
          'DIRECTORY_CREATE_ERROR'
        );
      }
    }

    // Write to permanent storage
    try {
      fs.writeFileSync(permanentPath, content);
    } catch (err) {
      if (err.code === 'ENOSPC') {
        throw new StorageError(
          'Insufficient disk space',
          507,
          'DISK_FULL'
        );
      }
      throw new StorageError(
        `Failed to write to permanent storage: ${err.message}`,
        500,
        'FILE_WRITE_ERROR'
      );
    }

    // Delete staging file
    try {
      fs.unlinkSync(stagingPath);
    } catch (err) {
      // Log warning but don't fail - file was successfully moved
      console.warn(`[Storage] Failed to delete staging file ${stagingPath}: ${err.message}`);
    }

    return permanentPath;
  } catch (err) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      `File move operation failed: ${err.message}`,
      500,
      'FILE_MOVE_ERROR'
    );
  }
};

/**
 * Create deliverable document in D4
 * @param {object} stagingRecord - DeliverableStaging document
 * @param {string} permanentPath - Path where file is stored
 * @param {string} committeeId - Committee ID for the deliverable
 * @returns {Promise<object>} Created Deliverable document
 * @throws {StorageError} If document creation fails
 */
const createDeliverableDocument = async (stagingRecord, permanentPath, committeeId) => {
  try {
    const mappedType = mapDeliverableType(stagingRecord.deliverableType);

    const deliverable = await Deliverable.create({
      committeeId,
      groupId: stagingRecord.groupId,
      submittedBy: stagingRecord.submittedBy,
      deliverableType: mappedType,
      sprintId: stagingRecord.sprintId || null,
      filePath: permanentPath,
      fileSize: stagingRecord.fileSize || 0,
      fileHash: stagingRecord.fileHash || 'unknown',
      format: stagingRecord.mimeType || 'unknown',
      submittedAt: new Date(),
      status: 'accepted',
    });

    return deliverable;
  } catch (err) {
    throw new StorageError(
      `Failed to create deliverable document: ${err.message}`,
      500,
      'DELIVERABLE_CREATE_ERROR'
    );
  }
};

/**
 * Delete staging record after successful storage
 * @param {string} stagingId - Staging record ID
 * @throws {StorageError} If deletion fails
 */
const deleteStagingRecord = async (stagingId) => {
  try {
    await DeliverableStaging.deleteOne({ stagingId });
  } catch (err) {
    throw new StorageError(
      `Failed to delete staging record: ${err.message}`,
      500,
      'STAGING_DELETE_ERROR'
    );
  }
};

/**
 * Store a deliverable from staging to permanent storage
 *
 * Issue #182 Acceptance Criteria:
 * - File moved from staging path to permanent path correctly
 * - SHA256 checksum verified — mismatch returns error
 * - Deliverable document created with correct fields and status: 'accepted'
 * - Staging record deleted after successful store
 * - Disk full scenario → 507, staging record untouched
 * - Staging record in wrong status → 400
 *
 * @param {string} stagingId - Staging record ID
 * @param {string} permanentDir - Destination permanent directory
 * @param {string} committeeId - Committee ID (defaults to 'com_test_001' for backward compatibility)
 * @returns {Promise<object>} Object with deliverable and permanentPath
 * @throws {StorageError} With appropriate status codes
 *   - 404: Staging record not found
 *   - 400: Invalid status, checksum mismatch
 *   - 507: Disk full
 *   - 500: Other storage/database errors
 */
const storeDeliverable = async (stagingId, permanentDir, committeeId = 'com_test_001') => {
  // Fetch staging record
  let stagingRecord;
  try {
    stagingRecord = await DeliverableStaging.findOne({ stagingId });
  } catch (err) {
    throw new StorageError(
      `Database query failed: ${err.message}`,
      500,
      'DATABASE_ERROR'
    );
  }

  if (!stagingRecord) {
    throw new StorageError(
      `Staging record not found: ${stagingId}`,
      404,
      'STAGING_NOT_FOUND'
    );
  }

  // Validate staging status
  if (stagingRecord.status !== 'staging') {
    throw new StorageError(
      `Staging record has invalid status: ${stagingRecord.status}. Expected 'staging'.`,
      400,
      'INVALID_STAGING_STATUS'
    );
  }

  // Verify checksum
  try {
    verifyChecksum(stagingRecord.tempFilePath, stagingRecord.fileHash);
  } catch (err) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      `Checksum verification failed: ${err.message}`,
      400,
      'CHECKSUM_ERROR'
    );
  }

  // Move file to permanent storage
  let permanentPath;
  try {
    permanentPath = moveFileToPermanentStorage(
      stagingRecord.tempFilePath,
      permanentDir,
      stagingId
    );
  } catch (err) {
    // On file move failure (including disk full), leave staging record untouched
    if (err instanceof StorageError) {
      throw err;
    }
    throw err;
  }

  // Create deliverable document
  let deliverable;
  try {
    deliverable = await createDeliverableDocument(
      stagingRecord,
      permanentPath,
      committeeId
    );
  } catch (err) {
    // Deliverable creation failed - staging already moved, log but continue
    console.error(`[Storage] Deliverable document creation failed: ${err.message}`);
    if (err instanceof StorageError) {
      throw err;
    }
    throw err;
  }

  // Delete staging record
  try {
    await deleteStagingRecord(stagingId);
  } catch (err) {
    // Staging record deletion failed but storage succeeded - log warning
    console.warn(`[Storage] Failed to delete staging record ${stagingId}: ${err.message}`);
  }

  return {
    deliverable,
    permanentPath,
  };
};

module.exports = {
  storeDeliverable,
  StorageError,
  calculateChecksum,
  mapDeliverableType,
  verifyChecksum,
  moveFileToPermanentStorage,
  createDeliverableDocument,
  deleteStagingRecord,
};
