const { verifyAccessToken } = require('../utils/jwt');
const Group = require('../models/Group');

/**
 * Middleware to verify JWT access token in Authorization header
 * Adds user info to req.user
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      next();
    } catch (tokenError) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      });
    }
  } catch (error) {
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Authentication check failed',
    });
  }
};

/**
 * Middleware to check user role
 * Usage: roleMiddleware(['admin', 'professor'])
 */
const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'User not authenticated',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource',
      });
    }

    next();
  };
};

/**
 * Middleware to check if request is from account owner or admin
 */
const ownerOrAdminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'User not authenticated',
    });
  }

  const targetUserId = req.params.userId;
  const isOwner = req.user.userId === targetUserId;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource',
    });
  }

  next();
};

/**
 * ========================================
 * Issue #67 Fix #4: System/M2M Authorization Middleware
 * ========================================
 * 
 * PROBLEM: Post-deadline sanitization endpoint only accepted coordinator/admin user roles.
 *          Requirements state that System (scheduled jobs, cron tasks, M2M clients) must also
 *          trigger this endpoint. There was NO mechanism for non-user service accounts.
 * 
 * SOLUTION: Implement systemTokenMiddleware to authenticate two types of principals:
 *           1. User-based auth: JWT token with coordinator/admin role (existing pattern)
 *           2. System-based auth: Service token in X-Service-Auth header (NEW)
 * 
 * TECHNICAL APPROACH:
 * ──────────────────
 * - Check if user is already authenticated (req.user exists with coordinator/admin role)
 *   → If yes: Allow immediately, mark as user call (req.isSystemCall = false)
 * 
 * - Check for X-Service-Auth header matching SYSTEM_SERVICE_TOKEN env var
 *   → If match: Create synthetic req.user object with role='system'
 *             → Mark as system call (req.isSystemCall = true)
 *             → Allow proceeding
 * 
 * - Neither condition met:
 *   → Reject with 403 Forbidden
 * 
 * SECURITY NOTES:
 * ───────────────
 * - Service token stored in environment variable (not in code)
 * - Token should be long, random string in production (not just "system")
 * - Use HTTPS to prevent token interception in transit
 * - Consider rate limiting on this endpoint for system calls
 * 
 * USAGE EXAMPLE:
 * ──────────────
 * // User-based: Standard JWT auth
 * curl -H "Authorization: Bearer $JWT_TOKEN" \
 *      -H "Content-Type: application/json" \
 *      -d '{"groupIds": [...]}' \
 *      POST http://api/v1/groups/advisor-sanitization
 * 
 * // System-based: Service token
 * curl -H "X-Service-Auth: system_token_from_env" \
 *      -H "Content-Type: application/json" \
 *      -d '{"groupIds": [...]}' \
 *      POST http://api/v1/groups/advisor-sanitization
 * 
 * ENVIRONMENT VARIABLES:
 * ──────────────────────
 * SYSTEM_SERVICE_TOKEN: Token for system/scheduler authentication
 *                      Default: "system" (SHOULD BE OVERRIDDEN IN PRODUCTION)
 * 
 * @middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
const systemTokenMiddleware = (req, res, next) => {
  // Issue #67 Fix #4: Check for user-based authentication (JWT token)
  // If user already authenticated with coordinator/admin role, allow immediately
  if (req.user && (req.user.role === 'coordinator' || req.user.role === 'admin')) {
    req.isSystemCall = false; // Mark as user-initiated call
    return next();
  }

  // Issue #67 Fix #4: Check for system/M2M authentication (service token)
  // Read X-Service-Auth header and compare with environment variable
  const serviceAuth = req.headers['x-service-auth'];
  const expectedToken = process.env.SYSTEM_SERVICE_TOKEN || 'system';

  if (serviceAuth === expectedToken) {
    // Issue #67 Fix #4: Service token matched - create synthetic user object
    // This allows service/scheduler calls to proceed with system identity
    req.isSystemCall = true; // Mark as system-initiated call
    req.user = {
      userId: 'system',
      role: 'system',
      isServiceAccount: true, // Flag to distinguish system calls from user calls
    };
    return next();
  }

  // Issue #67 Fix #4: Neither auth mechanism succeeded
  // Return 403 Forbidden with clear error message
  return res.status(403).json({
    code: 'FORBIDDEN',
    message: 'Invalid or missing authorization. Coordinator/admin role or system service token required.',
  });
};

/**
 * Issue #67: Combined auth for advisor sanitization (M2M + coordinator/admin JWT).
 * Order matters: valid X-Service-Auth is accepted WITHOUT a Bearer token so cron/M2M
 * is not blocked by authMiddleware.
 *
 * Allows: (1) SYSTEM_SERVICE_TOKEN via X-Service-Auth, or (2) valid JWT with coordinator/admin.
 */
const flexibleSystemOrRoleAuth = (req, res, next) => {
  const expectedToken = process.env.SYSTEM_SERVICE_TOKEN || 'system';
  const serviceAuth = req.headers['x-service-auth'];

  if (serviceAuth === expectedToken) {
    req.isSystemCall = true;
    req.user = {
      userId: 'system',
      role: 'system',
      isServiceAccount: true,
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = verifyAccessToken(token);
    if (decoded.role !== 'coordinator' && decoded.role !== 'admin') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource',
      });
    }
    req.user = decoded;
    req.isSystemCall = false;
    return next();
  } catch (tokenError) {
    return res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token',
    });
  }
};

/**
 * Global error handler for 401/403 responses
 * Can be used by frontend as middleware to intercept errors
 */
const errorHandler = (err, req, res, next) => {
  if (err.status === 401 || err.status === 403) {
    return res.status(err.status).json({
      code: err.code || 'AUTHORIZATION_ERROR',
      message: err.message,
    });
  }

  next(err);
};

/**
 * Cron / internal jobs: authenticate with `X-Service-Auth` when SERVICE_AUTH_TOKEN (or legacy aliases) matches.
 * Otherwise fall through to JWT Bearer auth. Used for advisor sanitization and similar system triggers.
 */
const serviceOrBearerAuth = (req, res, next) => {
  const expected =
    process.env.SERVICE_AUTH_TOKEN ||
    process.env.X_SERVICE_AUTH_SECRET ||
    process.env.INTERNAL_API_KEY;
  const headerVal = req.headers['x-service-auth'];
  if (expected && typeof headerVal === 'string' && headerVal === expected) {
    req.user = { userId: 'internal_service', role: 'coordinator' };
    req.authViaServiceToken = true;
    return next();
  }
  return authMiddleware(req, res, next);
};

/**
 * Auth middleware for /api/deliverables/* routes.
 * Validates Bearer JWT and enriches req.user with groupId looked up from the Group collection.
 * Sets req.user = { userId, role, groupId } on success.
 * Returns 401 if token is missing or invalid.
 */
const deliverableAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(authHeader.substring(7));
    } catch {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      });
    }

    const { userId, role } = decoded;

    const group = await Group.findOne({
      members: { $elemMatch: { userId, status: 'accepted' } },
    }).select('groupId').lean();

    req.user = { userId, role, groupId: group ? group.groupId : null };
    next();
  } catch (error) {
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Authentication check failed',
    });
  }
};

module.exports = {
  authMiddleware,
  roleMiddleware,
  ownerOrAdminMiddleware,
  systemTokenMiddleware,
  flexibleSystemOrRoleAuth,
  errorHandler,
  serviceOrBearerAuth,
  deliverableAuthMiddleware,
};
