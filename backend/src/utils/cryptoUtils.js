'use strict';

const crypto = require('crypto');

/**
 * cryptoUtils.js
 * 
 * Provides symmetric encryption for sensitive data stored in D2 (e.g. GitHub PAT, Jira Tokens).
 * Uses AES-256-GCM for authenticated encryption.
 * 
 * ENCRYPTION_KEY must be a 32-byte (256-bit) secret.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function resolveEncryptionKey() {
  const configuredKey = process.env.ENCRYPTION_KEY;

  if (configuredKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
    return Buffer.from(configuredKey, 'hex');
  }

  // Test runs still need deterministic crypto, but we avoid shipping a hardcoded fallback key.
  if (process.env.NODE_ENV === 'test') {
    const seed = process.env.JWT_SECRET || process.env.TEST_ENCRYPTION_SEED || 'test-seed';
    return crypto.createHash('sha256').update(seed).digest();
  }

  throw new Error('ENCRYPTION_KEY is required for encryption/decryption outside test mode');
}

/**
 * Encrypts a string.
 * Result format: iv:authTag:encryptedText
 */
function encrypt(text) {
  if (!text) return null;

  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a previously encrypted string.
 * Expected format: iv:authTag:encryptedText
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;

  try {
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      // If it doesn't match our format, it might be legacy plain text (for migration safety)
      return ciphertext;
    }

    const key = resolveEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('[cryptoUtils] Decryption failed:', err.message);
    // Return original if decryption fails (might be plain text or wrong key)
    return ciphertext;
  }
}

module.exports = { encrypt, decrypt };
