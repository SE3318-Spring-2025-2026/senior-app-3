const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const {
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
} = require('../controllers/auth');

// Public routes
router.post('/login', loginWithPassword);
router.post('/register', registerStudent);
router.post('/refresh', refreshAccessToken);
router.get('/github/oauth/callback', githubOAuthCallback);
router.post('/github/oauth/login', initiateGithubLoginOAuth);
router.post('/password-reset/request', requestPasswordReset);
router.post('/password-reset/validate-token', validatePasswordResetToken);
router.post('/password-reset/confirm', confirmPasswordReset);

// Protected routes
router.get('/users/professors', authMiddleware, listProfessors);
router.post('/logout', authMiddleware, logout);
router.post('/change-password', authMiddleware, changePassword);
router.post('/github/oauth/initiate', authMiddleware, initiateGithubOAuth);
router.post('/professor/onboard', authMiddleware, professorOnboard);
router.post('/password-reset/admin-initiate', authMiddleware, roleMiddleware(['admin']), adminInitiatePasswordReset);
router.get('/admin/users', authMiddleware, roleMiddleware(['admin']), getAdminUsersList);
router.post('/admin/professor/create', authMiddleware, roleMiddleware(['admin']), adminCreateProfessor);

module.exports = router;
