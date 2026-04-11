const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry an async function with delays between failures.
 * @param {() => Promise<unknown>} fn
 * @param {number} [maxRetries=3]
 * @param {number[]} [delays=[100, 200, 400]]
 * @returns {Promise<unknown>}
 */
async function withRetry(fn, maxRetries = 3, delays = [100, 200, 400]) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const wait = delays[attempt] !== undefined ? delays[attempt] : delays[delays.length - 1] || 0;
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

module.exports = { withRetry };
