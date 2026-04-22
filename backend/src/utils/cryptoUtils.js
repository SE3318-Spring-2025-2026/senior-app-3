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
const IV_LENGTH = 12;
const KEY_VERSION = 'v1';

function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY is required. Load it from environment or a secure vault provider.');
  }

  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes in hex format for AES-256-GCM.');
  }
  return key;
}

/**
 * Encrypts a string.
 * Result format: iv:authTag:encryptedText
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
 * Expected format: iv:authTag:encryptedText
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;

  try {
    const key = getKey();
    const parts = ciphertext.split(':');
    const [version, ivHex, authTagHex, encryptedHex] =
      parts.length === 4 ? parts : ['legacy', ...parts];

    if (!ivHex || !authTagHex || !encryptedHex) {
      // If it doesn't match our format, it might be legacy plain text (for migration safety)
      return ciphertext;
    }

    if (version !== KEY_VERSION && version !== 'legacy') {
      throw new Error(`Unsupported key version: ${version}`);
    }

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
