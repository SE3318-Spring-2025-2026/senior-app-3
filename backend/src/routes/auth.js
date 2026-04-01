const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const {
  loginWithPassword,
  registerStudent,
  refreshAccessToken,
  logout,
  initiateGithubOAuth,
  githubOAuthCallback,
} = require('../controllers/auth');

// Public routes
router.post('/login', loginWithPassword);
router.post('/register', registerStudent);
router.post('/refresh', refreshAccessToken);
router.get('/github/oauth/callback', githubOAuthCallback);

// Protected routes
router.post('/logout', authMiddleware, logout);
router.post('/github/oauth/initiate', authMiddleware, initiateGithubOAuth);

module.exports = router;
