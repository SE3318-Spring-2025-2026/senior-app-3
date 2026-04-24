'use strict';

const crypto = require('crypto');

/**
 * cryptoUtils.js
 *
 * Provides symmetric encryption for sensitive data stored in D2 (e.g. GitHub PAT, Jira Tokens).
 * Uses AES-256-GCM for authenticated encryption.
 *
 * ENCRYPTION_KEY must be a 32-byte (256-bit) secret expressed as a 64-character hex string.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_VERSION = 'v1';

function getKey() {
  const configuredKey = process.env.ENCRYPTION_KEY;

  if (configuredKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
    return Buffer.from(configuredKey, 'hex');
  }

  if (process.env.NODE_ENV === 'test') {
    const seed = process.env.JWT_SECRET || process.env.TEST_ENCRYPTION_SEED || 'test-seed';
    return crypto.createHash('sha256').update(seed).digest();
  }

  throw new Error('ENCRYPTION_KEY is required for encryption/decryption outside test mode');
}

/**
 * Encrypts a string.
 * Result format: version:iv:authTag:encryptedText
 */
function encrypt(text) {
  if (!text) return null;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${KEY_VERSION}:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a previously encrypted string.
 * Expected format: version:iv:authTag:encryptedText
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;

  try {
    const parts = ciphertext.split(':');
    const [version, ivHex, authTagHex, encryptedHex] = parts.length === 4 ? parts : ['legacy', ...parts];

    if (!ivHex || !authTagHex || !encryptedHex) {
      // Not in our encrypted format — treat as legacy/plain text
      return ciphertext;
    }

    if (version !== KEY_VERSION && version !== 'legacy') {
      throw new Error(`Unsupported key version: ${version}`);
    }

    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('[cryptoUtils] Decryption failed:', err.message);
    return ciphertext;
  }
}

module.exports = { encrypt, decrypt };
