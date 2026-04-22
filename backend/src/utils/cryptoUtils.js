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

// Fallback key for development only. In production, this must be in process.env.ENCRYPTION_KEY
const KEY = process.env.ENCRYPTION_KEY 
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') 
  : Buffer.from('8f1e6f7c9a2b5d4e3f1a2c3d4e5f607182930415263748596071829304152637', 'hex');

/**
 * Encrypts a string.
 * Result format: iv:authTag:encryptedText
 */
function encrypt(text) {
  if (!text) return null;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
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
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    
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
