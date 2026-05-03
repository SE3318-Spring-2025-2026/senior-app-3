const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '1h';
const JWT_REFRESH_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION || '7d';

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error(
    'JWT_SECRET and JWT_REFRESH_SECRET environment variables are required. Set them in your .env file before starting the server.'
  );
}

/**
 * Generate JWT access token
 * Payload includes: userId, role, iat (issued at), exp (expiration)
 */
const generateAccessToken = (userId, role) => {
  const payload = {
    userId,
    role,
    type: 'access',
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRATION,
    issuer: 'senior-app',
    subject: userId,
  });
};

/**
 * Generate JWT refresh token
 * Used for obtaining new access tokens
 */
const generateRefreshToken = (userId) => {
  const payload = {
    userId,
    type: 'refresh',
    jti: uuidv4(),
  };

  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRATION,
    issuer: 'senior-app',
    subject: userId,
  });
};

/**
 * Generate both access and refresh tokens
 */
const generateTokenPair = (userId, role) => {
  return {
    accessToken: generateAccessToken(userId, role),
    refreshToken: generateRefreshToken(userId),
  };
};

/**
 * Verify access token
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'senior-app',
    });
  } catch (error) {
    throw new Error(`Invalid access token: ${error.message}`);
  }
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET, {
      issuer: 'senior-app',
    });
  } catch (error) {
    throw new Error(`Invalid refresh token: ${error.message}`);
  }
};

/**
 * Decode token without verification (for debugging)
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
};
