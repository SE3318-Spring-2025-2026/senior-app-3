/**
 * Committee creation rate limiter (in-memory, no external dependency)
 *
 * Limits: max 10 committee creations per coordinator per 15-minute window.
 * Uses a sliding-window counter keyed by userId.
 *
 * Why in-memory? The project does not have express-rate-limit installed.
 * For multi-instance deployments this should be replaced with a Redis-backed
 * solution (e.g. rate-limiter-flexible).
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 10;

// Map<userId, { count: number, windowStart: number }>
const store = new Map();

/**
 * Express middleware — must be placed AFTER authMiddleware so req.user is set.
 */
const committeeLimiter = (req, res, next) => {
  const userId = req.user?.userId;
  if (!userId) {
    // authMiddleware should have already rejected this; be defensive
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Not authenticated.' });
  }

  const now = Date.now();
  const entry = store.get(userId);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // New window
    store.set(userId, { count: 1, windowStart: now });
    return next();
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Too many committee creation requests. Please wait ${retryAfterSec} seconds before trying again.`,
      retryAfterSeconds: retryAfterSec,
    });
  }

  entry.count += 1;
  return next();
};

module.exports = { committeeLimiter };
