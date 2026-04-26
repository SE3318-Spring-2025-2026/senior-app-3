import apiClient from './apiClient';

export const validateStudentId = async (studentId, email) => {
  const response = await apiClient.post('/onboarding/validate-student-id', {
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
  const response = await apiClient.post('/onboarding/verify-email', { token });
  return response.data;
};

export const completeOnboarding = async (userId) => {
  const response = await apiClient.post('/onboarding/complete', { userId });
  return response.data;
};
