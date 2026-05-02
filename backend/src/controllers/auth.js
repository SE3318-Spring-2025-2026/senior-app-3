const User = require('../models/User');
const Group = require('../models/Group');
const RefreshToken = require('../models/RefreshToken');
const StudentIdRegistry = require('../models/StudentIdRegistry');
const { hashPassword, comparePassword, validatePasswordStrength } = require('../utils/password');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { createAuditLog } = require('../services/auditService');
const { sendPasswordResetEmail } = require('../services/emailService');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { resolveStudentAffiliatedGroupId } = require('../utils/studentGroupMembership');

// In-memory CSRF state store: state → { userId, expiresAt }
const oauthStateStore = new Map();

// Purge expired state tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStateStore.entries()) {
    if (val.expiresAt < now) oauthStateStore.delete(key);
  }
}, 5 * 60 * 1000).unref();

const getGithubConfigError = () => {
  if (!process.env.GITHUB_CLIENT_ID) return 'GITHUB_CLIENT_ID';
  if (!process.env.GITHUB_CLIENT_SECRET) return 'GITHUB_CLIENT_SECRET';
  if (!process.env.GITHUB_REDIRECT_URI) return 'GITHUB_REDIRECT_URI';
  return null;
};

const buildGithubAuthorizationUrl = (state) => {
  const redirectUri = process.env.GITHUB_REDIRECT_URI;
  return (
    `https://github.com/login/oauth/authorize` +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=read:user`
  );
};

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

    // Look up groupId for students to populate the session/store (newest matching group wins)
    let groupId = null;
    if (user.role === 'student') {
      groupId = await resolveStudentAffiliatedGroupId(user.userId, {
        statusIn: ['active', 'pending_validation'],
      });
    }

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
      groupId,
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

    // Check if student ID is already registered
    const existingStudentUser = await User.findOne({ studentId: tokenPayload.studentId });
    if (existingStudentUser) {
      return res.status(409).json({
        code: 'DUPLICATE_STUDENT_ID',
        message: 'This student ID has already been registered',
        reason: 'Student ID already in use',
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      hashedPassword,
      role: 'student',
      accountStatus: 'pending_verification',
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
      const configError = getGithubConfigError();
      if (configError) {
        return res.status(500).json({
          code: 'GITHUB_CONFIG_MISSING',
          message: `GitHub OAuth is not configured. Missing ${configError}.`,
        });
      }

      const state = crypto.randomBytes(32).toString('hex');
      oauthStateStore.set(state, {
        userId: user.userId,
        mode: 'link',
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      response.githubOauthUrl = buildGithubAuthorizationUrl(state);
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

      let groupId = null;
      if (user.role === 'student') {
        groupId = await resolveStudentAffiliatedGroupId(user.userId, {
          statusIn: ['active', 'pending_validation'],
        });
      }

      return res.status(200).json({
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresIn: 3600, // 1 hour in seconds
        ...(user.role === 'student' ? { groupId } : {}),
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
 * Initiate GitHub OAuth (1.3-A)
 * Protected — requires authenticated user.
 * Generates a CSRF state token, stores it in memory with a 10-minute TTL,
 * and returns the GitHub authorization URL.
 */
const initiateGithubOAuth = async (req, res) => {
  try {
    const configError = getGithubConfigError();
    if (configError) {
      return res.status(500).json({
        code: 'GITHUB_CONFIG_MISSING',
        message: `GitHub OAuth is not configured. Missing ${configError}.`,
      });
    }

    const state = crypto.randomBytes(32).toString('hex');

    oauthStateStore.set(state, {
      userId: req.user.userId,
      mode: 'link',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const authorizationUrl = buildGithubAuthorizationUrl(state);

    return res.status(200).json({ authorizationUrl, state });
  } catch (error) {
    console.error('GitHub OAuth initiation error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to initiate GitHub OAuth',
    });
  }
};

/**
 * Initiate GitHub OAuth login (public)
 * Returns the GitHub authorization URL for sign-in.
 */
const initiateGithubLoginOAuth = async (req, res) => {
  try {
    const configError = getGithubConfigError();
    if (configError) {
      return res.status(500).json({
        code: 'GITHUB_CONFIG_MISSING',
        message: `GitHub OAuth is not configured. Missing ${configError}.`,
      });
    }

    const state = crypto.randomBytes(32).toString('hex');

    oauthStateStore.set(state, {
      mode: 'login',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const authorizationUrl = buildGithubAuthorizationUrl(state);

    return res.status(200).json({ authorizationUrl, state });
  } catch (error) {
    console.error('GitHub OAuth login initiation error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to initiate GitHub OAuth login',
    });
  }
};

/**
 * Handle GitHub OAuth callback (1.3-B)
 * Public GET — browser is redirected here by GitHub after authorization.
 * Verifies CSRF state, exchanges code for GitHub access token, fetches
 * the GitHub user, enforces uniqueness, and links the account.
 * Always responds with a 302 redirect to the frontend callback handler.
 */
const githubOAuthCallback = async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const callbackBase = `${frontendUrl}/auth/github/callback`;

  const redirectError = (code) =>
    res.redirect(`${callbackBase}?error=${encodeURIComponent(code)}`);

  try {
    const { code, state, error: oauthError } = req.query;

    // GitHub may send an error query param (e.g. user denied access)
    if (oauthError) {
      return redirectError(oauthError);
    }

    if (!code || !state) {
      return redirectError('MISSING_PARAMS');
    }

    // Verify CSRF state token
    const stateData = oauthStateStore.get(state);
    if (!stateData || stateData.expiresAt < Date.now()) {
      oauthStateStore.delete(state);
      return redirectError('INVALID_STATE');
    }

    const mode = stateData.mode || 'link';

    // Consume state (one-time use)
    const { userId } = stateData;
    oauthStateStore.delete(state);

    // Exchange authorization code for GitHub access token
    let githubAccessToken;
    try {
      const configError = getGithubConfigError();
      if (configError) {
        return redirectError('GITHUB_CONFIG_MISSING');
      }

      const tokenResponse = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: process.env.GITHUB_REDIRECT_URI,
        },
        { headers: { Accept: 'application/json' } }
      );

      if (tokenResponse.data.error) {
        console.error('GitHub token exchange error:', tokenResponse.data.error_description);
        return redirectError('TOKEN_EXCHANGE_FAILED');
      }

      githubAccessToken = tokenResponse.data.access_token;
    } catch (exchangeError) {
      console.error('GitHub token exchange request failed:', exchangeError.message);
      return redirectError('TOKEN_EXCHANGE_FAILED');
    }

    if (!githubAccessToken) {
      return redirectError('TOKEN_EXCHANGE_FAILED');
    }

    // Fetch GitHub user profile
    let githubUsername, githubId;
    try {
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${githubAccessToken}` },
      });
      githubUsername = userResponse.data.login;
      githubId = String(userResponse.data.id);
    } catch (userError) {
      console.error('GitHub /user API failed:', userError.message);
      return redirectError('GITHUB_API_FAILED');
    }

    if (!githubUsername || !githubId) {
      return redirectError('GITHUB_API_FAILED');
    }

    if (mode === 'login') {
      const user = await User.findOne({ githubId });
      if (!user) {
        return redirectError('GITHUB_NOT_LINKED');
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return redirectError('ACCOUNT_LOCKED');
      }

      if (user.accountStatus === 'suspended') {
        return redirectError('ACCOUNT_SUSPENDED');
      }

      user.loginAttempts = 0;
      user.lockedUntil = null;
      user.lastLogin = new Date();
      await user.save();

      const tokens = generateTokenPair(user.userId, user.role);

      let groupId = null;
      if (user.role === 'student') {
        groupId = await resolveStudentAffiliatedGroupId(user.userId, {
          statusIn: ['active', 'pending_validation'],
        });
      }

      const refreshTokenDoc = new RefreshToken({
        userId: user.userId,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        lastUsedAt: new Date(),
      });
      await refreshTokenDoc.save();

      const query = new URLSearchParams({
        status: 'logged_in',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: user.userId,
        email: user.email,
        role: user.role,
        emailVerified: String(user.emailVerified),
        accountStatus: user.accountStatus,
        requiresPasswordChange: String(user.requiresPasswordChange || false),
        ...(groupId ? { groupId } : {}),
      });

      return res.redirect(`${callbackBase}?${query.toString()}`);
    }

    // Linking flow
    const user = await User.findOne({ userId });
    if (!user) {
      return redirectError('USER_NOT_FOUND');
    }

    // Uniqueness check: reject if this GitHub ID is already linked to a different account
    const conflictById = await User.findOne({ githubId, userId: { $ne: userId } });
    if (conflictById) {
      return redirectError('GITHUB_ALREADY_LINKED');
    }

    // Uniqueness check: reject if this GitHub username is already taken by a different account
    const conflictByUsername = await User.findOne({
      githubUsername: githubUsername.toLowerCase(),
      userId: { $ne: userId },
    });
    if (conflictByUsername) {
      return redirectError('GITHUB_USERNAME_TAKEN');
    }

    // Persist GitHub identity on the user record
    user.githubUsername = githubUsername;
    user.githubId = githubId;
    await user.save();

    // Best-effort audit log
    try {
      await createAuditLog({
        action: 'GITHUB_OAUTH_LINKED',
        actorId: userId,
        targetId: userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed for GITHUB_OAUTH_LINKED (non-fatal):', auditError.message);
    }

    return res.redirect(
      `${callbackBase}?status=linked&githubUsername=${encodeURIComponent(githubUsername)}`
    );
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    return redirectError('SERVER_ERROR');
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
        await sendPasswordResetEmail(user.email, plainToken, user.userId);
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
    user.requiresPasswordChange = false;
    await user.save();

    const response = {
      userId: user.userId,
      accountStatus: user.accountStatus,
    };

    if (connectGithub) {
      const configError = getGithubConfigError();
      if (configError) {
        return res.status(500).json({
          code: 'GITHUB_CONFIG_MISSING',
          message: `GitHub OAuth is not configured. Missing ${configError}.`,
        });
      }

      const state = crypto.randomBytes(32).toString('hex');
      oauthStateStore.set(state, {
        userId: user.userId,
        mode: 'link',
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      response.githubOauthUrl = buildGithubAuthorizationUrl(state);
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
    const { userId: actorId, role } = req.user;

    // Verify admin role
    if (role !== 'admin') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only admins can initiate password resets for other users',
      });
    }

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
      await sendPasswordResetEmail(user.email, plainToken, user.userId);
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
      resetToken: plainToken,
      expiresIn: 15 * 60 * 1000, // 15 minutes in milliseconds
      resetLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${plainToken}`,
    });
  } catch (error) {
    console.error('Admin password reset error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Admin password reset failed',
    });
  }
};

/**
 * Get list of users for admin dropdown/search (admin-only)
 * Supports optional search/filter by email or userId
 */
const getAdminUsersList = async (req, res) => {
  try {
    const { search = '', limit = 50 } = req.query;

    const filter = {};
    if (search.trim()) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
      ];
    }

    // Fetch users with essential fields 
    const users = await User.find(filter)
      .select('userId email role accountStatus emailVerified')
      .limit(parseInt(limit, 10))
      .sort({ email: 1 })
      .exec();

    return res.status(200).json({
      users: users.map(user => ({
        userId: user.userId,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        emailVerified: user.emailVerified,
      })),
      total: users.length,
    });
  } catch (error) {
    console.error('Get users list error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to fetch users list',
    });
  }
};

/**
 * Admin-initiated professor account creation
 * Generates temporary password, sets force_password_change flag
 * Sends credentials via email
 */
const adminCreateProfessor = async (req, res) => {
  try {
    const { email, firstName = '', lastName = '' } = req.body;
    const { userId: actorId } = req.user;

    // Validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'A valid email address is required',
      });
    }

    // Check if account already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'A user with this email already exists',
      });
    }

    // Generate temporary password: 12 characters with mixed case, numbers, and special chars
    const tempPassword = crypto
      .randomBytes(6)
      .toString('hex')
      .slice(0, 8)
      .toUpperCase() + crypto.randomInt(100, 999) + '!A';

    const hashedPassword = await hashPassword(tempPassword);

    // Create professor account
    const professor = new User({
      email: email.toLowerCase(),
      hashedPassword,
      role: 'professor',
      firstName: firstName || '',
      lastName: lastName || '',
      accountStatus: 'pending',
      emailVerified: false,
      requiresPasswordChange: true,
    });

    await professor.save();

    // Audit log
    try {
      await createAuditLog({
        action: 'ACCOUNT_CREATED',
        actorId,
        targetId: professor.userId,
        changes: {
          email: professor.email,
          role: 'professor',
          tempPasswordGenerated: true,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.error('Audit log failed for ACCOUNT_CREATED (non-fatal):', auditError.message);
    }

    // Send credentials email
    try {
      const { sendProfessorCredentialsEmail } = require('../services/emailService');
      await sendProfessorCredentialsEmail(professor.email, tempPassword);
    } catch (emailError) {
      console.error('Credentials email failed (non-fatal):', emailError.message);
    }

    return res.status(201).json({
      message: 'Professor account created. Credentials have been sent via email.',
      userId: professor.userId,
      email: professor.email,
      firstName: professor.firstName,
      lastName: professor.lastName,
      accountStatus: professor.accountStatus,
      requiresPasswordChange: professor.requiresPasswordChange,
    });
  } catch (error) {
    console.error('Admin create professor error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to create professor account',
    });
  }
};

/**
 * List all professors (authenticated users only)
 */
const listProfessors = async (req, res) => {
  try {
    const professors = await User.find({ 
      role: 'professor',
      accountStatus: 'active' 
    })
      .select('userId email firstName lastName')
      .sort({ lastName: 1, firstName: 1 })
      .lean();

    return res.status(200).json({
      professors: professors.map(p => ({
        userId: p.userId,
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email,
      })),
      total: professors.length,
    });
  } catch (error) {
    console.error('List professors error:', error);
    res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Failed to fetch professors list',
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
  initiateGithubLoginOAuth,
  githubOAuthCallback,
  requestPasswordReset,
  validatePasswordResetToken,
  confirmPasswordReset,
  professorOnboard,
  adminInitiatePasswordReset,
  getAdminUsersList,
  adminCreateProfessor,
  listProfessors,
};
