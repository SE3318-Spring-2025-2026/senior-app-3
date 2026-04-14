'use strict';

const fs = require('fs');

/**
 * Magic byte signatures for accepted file types.
 * Read from the first 4 bytes of the file to detect real format
 * regardless of the extension or MIME type reported by the client.
 */
const MAGIC_BYTES = {
  pdf:  [0x25, 0x50, 0x44, 0x46], // %PDF
  zip:  [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04  (also covers .docx)
};

/** Max file sizes in bytes per deliverable type */
const SIZE_LIMITS_MB = {
  proposal:         50,
  statement_of_work: 50,
  demo:             500,
  interim_report:   100,
  final_report:     500,
};

/**
 * Read the first N bytes of a file from disk.
 * Returns a Buffer, or null if the file cannot be read.
 *
 * @param {string} filePath
 * @param {number} byteCount
 * @returns {Buffer|null}
 */
const readMagicBytes = (filePath, byteCount = 4) => {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(byteCount);
    fs.readSync(fd, buf, 0, byteCount, 0);
    return buf;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
};

/**
 * Check whether a Buffer starts with an expected byte sequence.
 *
 * @param {Buffer} buf
 * @param {number[]} signature
 * @returns {boolean}
 */
const startsWith = (buf, signature) =>
  buf && signature.every((byte, i) => buf[i] === byte);

/**
 * Derive the canonical format name from file path and MIME type,
 * then verify the file's actual magic bytes match.
 *
 * Accepted: .pdf, .docx, .md, .zip
 *
 * @param {string} filePath   - Absolute path to the file on disk
 * @param {string} mimeType   - MIME type reported by multer / client
 * @param {string} _deliverableType - Reserved for future per-type rules
 * @returns {{ valid: boolean, format?: string, error?: string }}
 */
const validateFormat = (filePath, mimeType, _deliverableType) => {
  const ext = (filePath.split('.').pop() || '').toLowerCase();

  // ── Markdown ──────────────────────────────────────────────────────────────
  // No reliable magic bytes; accept by extension + text/plain MIME.
  if (ext === 'md') {
    const validMime = mimeType === 'text/plain' || mimeType === 'text/markdown';
    if (!validMime) {
      return {
        valid: false,
        error: `Markdown file must have MIME type text/plain or text/markdown, got '${mimeType}'`,
      };
    }
    return { valid: true, format: 'md' };
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  if (ext === 'pdf') {
    const buf = readMagicBytes(filePath);
    if (!buf) {
      return { valid: false, error: 'Could not read file from disk' };
    }
    if (!startsWith(buf, MAGIC_BYTES.pdf)) {
      return { valid: false, error: 'File content does not match PDF format (bad magic bytes)' };
    }
    return { valid: true, format: 'pdf' };
  }

  // ── DOCX ──────────────────────────────────────────────────────────────────
  // DOCX is a ZIP archive; magic bytes are identical to .zip.
  if (ext === 'docx') {
    const buf = readMagicBytes(filePath);
    if (!buf) {
      return { valid: false, error: 'Could not read file from disk' };
    }
    if (!startsWith(buf, MAGIC_BYTES.zip)) {
      return { valid: false, error: 'File content does not match DOCX format (bad magic bytes)' };
    }
    return { valid: true, format: 'docx' };
  }

  // ── ZIP ───────────────────────────────────────────────────────────────────
  if (ext === 'zip') {
    const buf = readMagicBytes(filePath);
    if (!buf) {
      return { valid: false, error: 'Could not read file from disk' };
    }
    if (!startsWith(buf, MAGIC_BYTES.zip)) {
      return { valid: false, error: 'File content does not match ZIP format (bad magic bytes)' };
    }
    return { valid: true, format: 'zip' };
  }

  // ── Unknown extension ─────────────────────────────────────────────────────
  return {
    valid: false,
    error: `Unsupported file extension '.${ext}'. Accepted: .pdf, .docx, .md, .zip`,
  };
};

/**
 * Check whether a file size is within the allowed limit for the given
 * deliverable type.
 *
 * @param {number} fileSizeBytes
 * @param {string} deliverableType
 * @returns {{ withinLimit: boolean, maxAllowedMb: number, actualMb: number }}
 */
const validateFileSize = (fileSizeBytes, deliverableType) => {
  const maxMb = SIZE_LIMITS_MB[deliverableType] ?? 50;
  const maxBytes = maxMb * 1024 * 1024;
  const actualMb = parseFloat((fileSizeBytes / (1024 * 1024)).toFixed(2));

  return {
    withinLimit: fileSizeBytes <= maxBytes,
    maxAllowedMb: maxMb,
    actualMb,
  };
};

module.exports = { validateFormat, validateFileSize };
