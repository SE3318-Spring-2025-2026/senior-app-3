'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Deliverable = require('../models/Deliverable');

const PERMANENT_BASE = path.join(process.cwd(), 'uploads', 'deliverables');

/**
 * Derive file extension from the file path, falling back to MIME type.
 * @param {string} filePath
 * @param {string} mimeType
 * @returns {string} Extension including leading dot, e.g. '.pdf'
 */
const resolveExtension = (filePath, mimeType) => {
  const extFromPath = path.extname(filePath);
  if (extFromPath) return extFromPath;

  const mimeToExt = {
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return mimeToExt[mimeType] || '.bin';
};

/**
 * persistDeliverableFile(stagingId, groupId, deliverableType)
 *
 * Process 5.5 — Move the staged file to permanent storage.
 *
 * Steps:
 *  1. Reads the staging record to find the temp file path and expected hash.
 *  2. Verifies SHA256 checksum matches the value stored in the staging record.
 *  3. Creates uploads/deliverables/{groupId}/ directory if it does not exist.
 *  4. Writes file to uploads/deliverables/{groupId}/{uuid}.{ext}.
 *  5. Deletes the staging temp file (best-effort; logs warning on failure).
 *
 * On disk-full the write throws ENOSPC — the caller should propagate this as 507
 * and leave the staging record intact so the user can retry.
 *
 * @param {import('../models/DeliverableStaging').default} stagingRecord - DeliverableStaging document
 * @returns {{ savedPath: string, fileSize: number, checksum: string, format: string, timestamp: string }}
 */
const persistDeliverableFile = (stagingRecord) => {
  const { tempFilePath, fileHash, fileSize, mimeType } = stagingRecord;

  // 1. Verify SHA256 checksum and read file content
  if (!fs.existsSync(tempFilePath)) {
    const err = new Error(`Staging file not found: ${tempFilePath}`);
    err.statusCode = 404;
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  const content = fs.readFileSync(tempFilePath);
  const actualHash = crypto.createHash('sha256').update(content).digest('hex');

  if (actualHash !== fileHash) {
    const err = new Error('File checksum mismatch — file may have been corrupted');
    err.statusCode = 400;
    err.code = 'CHECKSUM_MISMATCH';
    throw err;
  }

  // 2. Determine extension and format
  const ext = resolveExtension(tempFilePath, mimeType);
  const format = ext.replace(/^\./, '').toLowerCase() || 'bin';

  // 3. Create destination directory
  const destDir = path.join(PERMANENT_BASE, stagingRecord.groupId);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // 4. Write to permanent path (unique name via UUID)
  const uniqueName = `${uuidv4().replace(/-/g, '')}${ext}`;
  const savedPath = path.join(destDir, uniqueName);

  try {
    fs.writeFileSync(savedPath, content);
  } catch (err) {
    if (err.code === 'ENOSPC') {
      const e = new Error('Insufficient disk space');
      e.statusCode = 507;
      e.code = 'DISK_FULL';
      throw e;
    }
    throw err;
  }

  // 5. Remove staging file (best-effort)
  try {
    fs.unlinkSync(tempFilePath);
  } catch (err) {
    console.warn(`[storageService] Could not delete staging file ${tempFilePath}: ${err.message}`);
  }

  return {
    savedPath,
    fileSize,
    checksum: fileHash,
    format,
    timestamp: new Date().toISOString(),
  };
};

/**
 * createFinalRecord(stagingRecord, savedPath, session)
 *
 * Creates the permanent Deliverable document in D4 (status: 'accepted').
 * Computes version by counting prior submissions for the same group + deliverableType.
 * Pass a Mongoose ClientSession to run this inside a transaction.
 *
 * @param {import('../models/DeliverableStaging').default} stagingRecord - DeliverableStaging document
 * @param {string} savedPath - Absolute path where the file was written
 * @param {import('mongoose').ClientSession} [session] - Optional Mongoose session for transactions
 * @returns {Promise<import('../models/Deliverable').default>} Created Deliverable document
 */
const createFinalRecord = async (stagingRecord, savedPath, session) => {
  const { groupId, deliverableType, sprintId, submittedBy, description, fileHash, fileSize } = stagingRecord;

  const priorCount = await Deliverable.countDocuments({ groupId, deliverableType }).session(session ?? null);
  const version = priorCount + 1;

  const ext = path.extname(savedPath);
  const format = ext.replace(/^\./, '').toLowerCase() || 'bin';

  const [deliverable] = await Deliverable.create(
    [
      {
        groupId,
        deliverableType,
        sprintId: sprintId || null,
        submittedBy,
        description: description || null,
        filePath: savedPath,
        fileSize,
        fileHash,
        format,
        status: 'accepted',
        version,
        submittedAt: new Date(),
      },
    ],
    { session: session ?? null }
  );

  return deliverable;
};

module.exports = {
  persistDeliverableFile,
  createFinalRecord,
};
