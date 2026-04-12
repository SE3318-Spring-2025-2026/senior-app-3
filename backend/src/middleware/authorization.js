/**
 * Issue #87: Authorization Middleware (Combined Auth + Role Check)
 * 
 * Purpose:
 * Combine authMiddleware + roleMiddleware into a single convenience middleware
 * for routes that always need both checks (like committees endpoint).
 * 
 * Usage:
 * router.post('/publish', authorize(['coordinator']), publishCommitteeHandler)
 * 
 * Equivalent to:
 * router.post('/publish', authMiddleware, roleMiddleware(['coordinator']), ...)
 * 
 * Benefits:
 * - Cleaner route definitions
 * - Ensures auth is checked before role (correct order)
 * - Less repetition across routes
 */

const { authMiddleware, roleMiddleware } = require('./auth');

/**
 * Issue #87: Combined Authorization Middleware
 * 
 * @param {string[]} allowedRoles - Array of allowed role names
 * @returns {Function[]} - Array of middleware functions: [authMiddleware, roleMiddleware(...)]
 */
const authorize = (allowedRoles = []) => {
  return [authMiddleware, roleMiddleware(allowedRoles)];
};

module.exports = {
  authorize,
};
