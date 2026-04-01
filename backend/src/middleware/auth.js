const { verifyAccessToken } = require('../utils/jwt');

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

module.exports = {
  authMiddleware,
  roleMiddleware,
  ownerOrAdminMiddleware,
  errorHandler,
};
