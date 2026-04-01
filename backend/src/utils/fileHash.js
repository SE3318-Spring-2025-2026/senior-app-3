const crypto = require('crypto');

/**
 * Generate SHA-256 hash of a file stream
 * Uses streaming to handle large files efficiently
 * 
 * @param {Stream} fileStream - File stream object
 * @returns {Promise<string>} SHA-256 hash in hex format
 */
async function hashFileStream(fileStream) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');

    fileStream.on('data', (chunk) => {
      hash.update(chunk);
    });

    fileStream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    fileStream.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Generate SHA-256 hash of a buffer or string
 * 
 * @param {Buffer|string} data - Data to hash
 * @returns {string} SHA-256 hash in hex format
 */
function hashData(data) {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

module.exports = {
  hashFileStream,
  hashData,
};
