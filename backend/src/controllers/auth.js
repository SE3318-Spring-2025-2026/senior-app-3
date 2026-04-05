const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const StudentIdRegistry = require('../models/StudentIdRegistry');
const { hashPassword, comparePassword, validatePasswordStrength } = require('../utils/password');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { createAuditLog } = require('../services/auditService');
const { sendPasswordResetEmail } = require('../services/emailService');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Login with email and password
 */
const loginWithPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Email and password are required',
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(401).json({
        code: 'ACCOUNT_LOCKED',
        message: 'Account is temporarily locked. Try again later.',
      });
    }

    // Check if account is suspended
    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended',
      });
    }

    // Verify password
    const passwordMatch = await comparePassword(password, user.hashedPassword);

    if (!passwordMatch) {
      // Increment failed attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
      }
      await user.save();

      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    // Reset failed attempts on successful login
    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const tokens = generateTokenPair(user.userId, user.role);

    // Save refresh token to database
    const refreshTokenDoc = new RefreshToken({
      userId: user.userId,
      token: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      lastUsedAt: new Date(),
    });
    await refreshTokenDoc.save();

    return res.status(200).json({
      userId: user.userId,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      requiresPasswordChange: user.requiresPasswordChange || false,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: 3600, // 1 hour in seconds
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Login failed',
    });
  }
};

/**
 * Register new student account
 */
const registerStudent = async (req, res) => {
  try {
    const { validationToken, email, password, connectGithub } = req.body;

    // Validation
    if (!email || !password || !validationToken) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Email, password, and validationToken are required',
      });
    }

    // Validate password strength
    const { isValid, errors: passwordErrors } = validatePasswordStrength(password);
    if (!isValid) {
      return res.status(400).json({
        code: 'WEAK_PASSWORD',
        message: 'Password does not meet requirements',
        details: passwordErrors,
      });
    }

    // Verify and decode validation token
    let tokenPayload;
    try {
      tokenPayload = jwt.verify(validationToken, process.env.JWT_SECRET || 'your-secret-key');
    } catch (error) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Validation token is invalid or expired',
        details: 'Please re-validate your student ID',
      });
    }

    // Check if token is for student ID validation
    if (tokenPayload.type !== 'student_id_validation') {
      return res.status(401).json({
        code: 'INVALID_TOKEN_TYPE',
        message: 'Token is not valid for registration',
      });
    }

    // Verify email in token matches request email
    if (tokenPayload.email !== email.toLowerCase()) {
      return res.status(422).json({
        code: 'EMAIL_MISMATCH',
        message: 'Email does not match validated student ID',
      });
    }

    // Verify student ID is still in registry
    const registeredStudent = await StudentIdRegistry.findOne({
      studentId: tokenPayload.studentId,
      email: tokenPayload.email,
      status: 'valid',
    });

    if (!registeredStudent) {
      return res.status(422).json({
        code: 'INVALID_STUDENT_ID',
        message: 'Student ID is no longer valid',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'User with this email already exists',
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      hashedPassword,
      role: 'student',
      accountStatus: 'pending',
      studentId: tokenPayload.studentId,
    });

    await user.save();

    // Best-effort audit log: failure here must not fail the registration response
    try {
      await createAuditLog({
        action: 'ACCOUNT_CREATED',
        actorId: user.userId,
        targetId: user.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed for ACCOUNT_CREATED (non-fatal):', auditError.message);
    }

    // Generate tokens
    const tokens = generateTokenPair(user.userId, user.role);

    // Save refresh token
    const refreshTokenDoc = new RefreshToken({
      userId: user.userId,
      token: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      lastUsedAt: new Date(),
    });
    await refreshTokenDoc.save();

    const response = {
      userId: user.userId,
      email: user.email,
      studentId: user.studentId,
      accountStatus: user.accountStatus,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };

    // Add GitHub OAuth URL if requested
    if (connectGithub) {
      const state = crypto.randomBytes(16).toString('hex');
      // Store state in session or cache (TODO: implement)
      response.githubOauthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${process.env.GITHUB_REDIRECT_URI}&state=${state}&scope=user`;
    }

    return res.status(201).json(response);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Registration failed',
    });
  }
};

/**
 * Refresh access token using refresh token
 * Implements token rotation: old refresh token is invalidated, new pair is issued
 */
const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Refresh token is required',
      });
    }

    try {
      // Verify refresh token
      const decoded = verifyRefreshToken(refreshToken);

      // Check if token exists and is not revoked
      const tokenDoc = await RefreshToken.findOne({
        token: refreshToken,
        isRevoked: false,
      });

      if (!tokenDoc) {
        return res.status(401).json({
          code: 'INVALID_TOKEN',
          message: 'Refresh token is invalid or has been revoked',
        });
      }

      // Check if token is expired
      if (tokenDoc.expiresAt < new Date()) {
        return res.status(401).json({
          code: 'TOKEN_EXPIRED',
          message: 'Refresh token has expired',
        });
      }

      // Get user
      const user = await User.findOne({ userId: decoded.userId });

      if (!user || user.accountStatus === 'suspended') {
        return res.status(401).json({
          code: 'INVALID_USER',
          message: 'User not found or account is suspended',
        });
      }

      // Generate new token pair
      const newTokens = generateTokenPair(user.userId, user.role);

      // Rotate refresh token: revoke old, save new
      tokenDoc.isRevoked = true;
      await tokenDoc.save();

      const newRefreshTokenDoc = new RefreshToken({
        userId: user.userId,
        token: newTokens.refreshToken,
        rotatedFrom: tokenDoc.tokenId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        lastUsedAt: new Date(),
      });
      await newRefreshTokenDoc.save();

      return res.status(200).json({
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresIn: 3600, // 1 hour in seconds
      });
    } catch (tokenError) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Token refresh failed',
    });
  }
};

/**
 * Logout: revoke refresh token
 */
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await RefreshToken.updateOne(
        { token: refreshToken },
        { isRevoked: true }
      );
    }

    return res.status(200).json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Logout failed',
    });
  }
};

/**
 * Initiate GitHub OAuth
 */
const initiateGithubOAuth = async (req, res) => {
  try {
    const { redirectUri } = req.body;

    if (!redirectUri) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Redirect URI is required',
      });
    }

    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // TODO: Store state in Redis or database with expiration
    // For now, we'll just generate it

    const authorizationUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&state=${state}&scope=user`;

    return res.status(200).json({
      authorizationUrl,
      state,
    });
  } catch (error) {
    console.error('GitHub OAuth initiation error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to initiate GitHub OAuth',
    });
  }
};

/**
 * Handle GitHub OAuth callback
 */
const githubOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Code and state parameters are required',
      });
    }

    // TODO: Verify state token
    // For now, we'll accept it

    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI,
      },
      {
        headers: { Accept: 'application/json' },
      }
    );

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      return res.status(400).json({
        code: 'OAUTH_FAILED',
        message: 'Failed to obtain GitHub access token',
      });
    }

    // Get GitHub user info
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { login: githubUsername, id: githubId } = userResponse.data;

    // TODO: Link GitHub to current user or create new account
    // For now, just return the GitHub info

    return res.status(200).json({
      githubUsername,
      githubId,
      linkedUserId: req.user?.userId || null,
    });
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'GitHub OAuth callback failed',
    });
  }
};

/**
 * Change password and revoke all refresh tokens for the user
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { userId } = req.user;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'currentPassword and newPassword are required',
      });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    const passwordMatch = await comparePassword(currentPassword, user.hashedPassword);
    if (!passwordMatch) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
      });
    }

    const { isValid, errors: passwordErrors } = validatePasswordStrength(newPassword);
    if (!isValid) {
      return res.status(400).json({
        code: 'WEAK_PASSWORD',
        message: 'New password does not meet requirements',
        details: passwordErrors,
      });
    }

    user.hashedPassword = await hashPassword(newPassword);
    await user.save();

    // Revoke all refresh tokens for this user
    await RefreshToken.updateMany({ userId }, { isRevoked: true });

    return res.status(200).json({
      message: 'Password changed successfully. All sessions have been invalidated.',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Password change failed',
    });
  }
};

/**
 * Request password reset — always returns 200 to prevent user enumeration (flow f20)
 */
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'A valid email address is required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      const now = new Date();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);

      // Rate limiting: max 5 requests per hour
      if (user.passwordResetWindowStart && user.passwordResetWindowStart > oneHourAgo) {
        if (user.passwordResetSentCount >= 5) {
          // Non-revealing: still return 200, just don't send email
          return res.status(200).json({
            message: 'If an account with that email exists, a password reset link has been sent.',
          });
        }
        user.passwordResetSentCount += 1;
      } else {
        user.passwordResetWindowStart = now;
        user.passwordResetSentCount = 1;
      }

      // Generate plain token, store SHA-256 hash
      const plainToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

      user.passwordResetToken = hashedToken;
      user.passwordResetTokenExpiry = new Date(now.getTime() + 15 * 60 * 1000);
      await user.save();

      try {
        await sendPasswordResetEmail(user.email, plainToken);
      } catch (emailError) {
        console.error('Password reset email failed (non-fatal):', emailError.message);
      }

      try {
        await createAuditLog({
          action: 'PASSWORD_RESET_REQUESTED',
          actorId: user.userId,
          targetId: user.userId,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (auditError) {
        console.error('Audit log failed for PASSWORD_RESET_REQUESTED (non-fatal):', auditError.message);
      }
    }

    return res.status(200).json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Password reset request failed',
    });
  }
};

/**
 * Validate a password reset token without consuming it (read-only check)
 * Used by the frontend on page load to detect expired links immediately
 */
const validatePasswordResetToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Token is required',
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        code: 'INVALID_TOKEN',
        message: 'Reset token is invalid or has expired',
      });
    }

    return res.status(200).json({ valid: true });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Token validation failed',
    });
  }
};

/**
 * Confirm password reset with one-time token (flow f21)
 */
const confirmPasswordReset = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Token and newPassword are required',
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        code: 'INVALID_TOKEN',
        message: 'Password reset token is invalid or has expired',
      });
    }

    const { isValid, errors: passwordErrors } = validatePasswordStrength(newPassword);
    if (!isValid) {
      return res.status(400).json({
        code: 'WEAK_PASSWORD',
        message: 'New password does not meet requirements',
        details: passwordErrors,
      });
    }

    // Update password and invalidate token (single-use enforcement)
    user.hashedPassword = await hashPassword(newPassword);
    user.passwordResetToken = null;
    user.passwordResetTokenExpiry = null;
    user.passwordResetSentCount = 0;
    user.passwordResetWindowStart = null;
    await user.save();

    // Revoke all refresh tokens (log out all sessions)
    await RefreshToken.updateMany({ userId: user.userId }, { isRevoked: true });

    try {
      await createAuditLog({
        action: 'PASSWORD_RESET_CONFIRMED',
        actorId: user.userId,
        targetId: user.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed for PASSWORD_RESET_CONFIRMED (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      message: 'Password has been reset successfully. All sessions have been invalidated.',
    });
  } catch (error) {
    console.error('Password reset confirm error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Password reset failed',
    });
  }
};

/**
 * Professor first-login forced password change (flow f07)
 * Requires bearerAuth — professor must be logged in with temp password
 */
const professorOnboard = async (req, res) => {
  try {
    const { newPassword, connectGithub } = req.body;
    const { userId } = req.user;

    if (!newPassword) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'newPassword is required',
      });
    }

    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    if (user.role !== 'professor') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This endpoint is for professors only',
      });
    }

    const { isValid, errors: passwordErrors } = validatePasswordStrength(newPassword);
    if (!isValid) {
      return res.status(400).json({
        code: 'WEAK_PASSWORD',
        message: 'Password does not meet requirements',
        details: passwordErrors,
      });
    }

    user.hashedPassword = await hashPassword(newPassword);
    user.accountStatus = 'active';
    user.requiresPasswordChange = false;
    await user.save();

    const response = {
      userId: user.userId,
      accountStatus: user.accountStatus,
    };

    if (connectGithub) {
      const state = crypto.randomBytes(16).toString('hex');
      response.githubOauthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${process.env.GITHUB_REDIRECT_URI}&state=${state}&scope=user`;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Professor onboard error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Professor onboarding failed',
    });
  }
};

/**
 * Admin-initiated password reset for any user
 * Requires admin role
 */
const adminInitiatePasswordReset = async (req, res) => {
  try {
    const { userId: targetUserId, email: targetEmail } = req.body;
    const { userId: actorId } = req.user;

    if (!targetUserId && !targetEmail) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Either userId or email is required',
      });
    }

    const query = targetUserId
      ? { userId: targetUserId }
      : { email: targetEmail.toLowerCase() };

    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

    user.passwordResetToken = hashedToken;
    user.passwordResetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
    user.passwordResetSentCount = 0;
    user.passwordResetWindowStart = null;
    await user.save();

    try {
      await sendPasswordResetEmail(user.email, plainToken);
    } catch (emailError) {
      console.error('Password reset email failed (non-fatal):', emailError.message);
    }

    try {
      await createAuditLog({
        action: 'PASSWORD_RESET_ADMIN_INITIATED',
        actorId,
        targetId: user.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed for PASSWORD_RESET_ADMIN_INITIATED (non-fatal):', auditError.message);
    }

    return res.status(200).json({
      message: 'Password reset initiated. The user will receive an email with reset instructions.',
      userId: user.userId,
      email: user.email,
    });
  } catch (error) {
    console.error('Admin password reset error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Admin password reset failed',
    });
  }
};

module.exports = {
  loginWithPassword,
  registerStudent,
  refreshAccessToken,
  logout,
  changePassword,
  initiateGithubOAuth,
  githubOAuthCallback,
  requestPasswordReset,
  validatePasswordResetToken,
  confirmPasswordReset,
  professorOnboard,
  confirmPasswordReset,
  adminInitiatePasswordReset,
};
