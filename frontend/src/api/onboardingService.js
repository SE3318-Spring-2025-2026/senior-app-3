import apiClient from './apiClient';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002/api/v1';

export const validateStudentId = async (studentId, email) => {
  const response = await axios.post(`${API_BASE_URL}/onboarding/validate-student-id`, {
    studentId,
    email,
  });
  return response.data;
};

export const sendVerificationEmail = async (userId) => {
  const response = await apiClient.post('/onboarding/send-verification-email', { userId });
  return response.data;
};

export const verifyEmail = async (token) => {
  const response = await axios.post(`${API_BASE_URL}/onboarding/verify-email`, { token });
  return response.data;
};

export const completeOnboarding = async (userId) => {
  const response = await apiClient.post('/onboarding/complete', { userId });
  return response.data;
};
