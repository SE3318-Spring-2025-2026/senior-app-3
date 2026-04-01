import apiClient from './apiClient';

/**
 * Auth API service - handles all authentication-related API calls
 */

/**
 * Login with email and password
 */
export const loginUser = async (email, password) => {
  const response = await apiClient.post('/auth/login', {
    email,
    password,
  });
  return response.data;
};

/**
 * Register new student account
 */
export const registerStudent = async (validationToken, email, password, connectGithub = false) => {
  const response = await apiClient.post('/auth/register', {
    validationToken,
    email,
    password,
    connectGithub,
  });
  return response.data;
};

/**
 * Refresh access token using refresh token
 */
export const refreshAccessToken = async (refreshToken) => {
  const response = await apiClient.post('/auth/refresh', {
    refreshToken,
  });
  return response.data;
};

/**
 * Logout and revoke refresh token
 */
export const logoutUser = async (refreshToken) => {
  const response = await apiClient.post('/auth/logout', {
    refreshToken,
  });
  return response.data;
};

/**
 * Initiate GitHub OAuth
 */
export const initiateGithubOAuth = async (redirectUri) => {
  const response = await apiClient.post('/auth/github/oauth/initiate', {
    redirectUri,
  });
  return response.data;
};

/**
 * Get account information
 */
export const getAccount = async (userId) => {
  const response = await apiClient.get(`/onboarding/accounts/${userId}`);
  return response.data;
};

/**
 * Update account information
 */
export const updateAccount = async (userId, updates) => {
  const response = await apiClient.patch(`/onboarding/accounts/${userId}`, updates);
  return response.data;
};

const authService = {
  loginUser,
  registerStudent,
  refreshAccessToken,
  logoutUser,
  initiateGithubOAuth,
  getAccount,
  updateAccount,
};

export default authService;
