import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { registerStudent } from '../api/authService';
import { validateStudentId } from '../api/onboardingService';
import { validatePasswordStrength } from '../utils/passwordValidator';
import './AuthForms.css';

/**
 * Registration Form Component with Multi-Step Student ID Validation
 */
const RegisterForm = () => {
  const navigate = useNavigate();
  const { setAuth, setError, error } = useAuthStore();

  const [currentStep, setCurrentStep] = useState(1); // 1 = validation, 2 = registration
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [passwordStrength, setPasswordStrength] = useState({
    isValid: true,
    errors: [],
  });

  // Step 1: Student ID Validation
  const [validationData, setValidationData] = useState({
    studentId: '',
    email: '',
    validating: false,
    validationFeedback: {
      status: null, // 'validating', 'success', 'error'
      message: '',
    },
  });

  // Step 2: Account Creation
  const [registrationData, setRegistrationData] = useState({
    password: '',
    confirmPassword: '',
    connectGithub: false,
    validationToken: null,
  });

  // Handle Student ID validation field changes
  const handleValidationChange = (e) => {
    const { name, value } = e.target;
    setValidationData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Clear errors when user starts typing
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }

    // Reset feedback when user changes input
    if (validationData.validationFeedback.status !== null) {
      setValidationData((prev) => ({
        ...prev,
        validationFeedback: {
          status: null,
          message: '',
        },
      }));
    }
  };

  // Handle registration field changes
  const handleRegistrationChange = (e) => {
    const { name, value, type, checked } = e.target;
    setRegistrationData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear field error when user starts typing
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }

    // Check password strength
    if (name === 'password') {
      setPasswordStrength(validatePasswordStrength(value));
    }
  };

  // Validate student ID
  const handleValidateStudentId = async (e) => {
    e.preventDefault();

    const errors = {};

    if (!validationData.studentId.trim()) {
      errors.studentId = 'Student ID is required';
    }

    if (!validationData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(validationData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationData((prev) => ({
      ...prev,
      validating: true,
      validationFeedback: {
        status: 'validating',
        message: 'Validating student ID...',
      },
    }));

    try {
      const response = await validateStudentId(
        validationData.studentId,
        validationData.email
      );

      if (response.valid) {
        setValidationData((prev) => ({
          ...prev,
          validating: false,
          validationFeedback: {
            status: 'success',
            message: 'Student ID validated successfully!',
          },
        }));

        setRegistrationData((prev) => ({
          ...prev,
          validationToken: response.validationToken,
        }));
      } else {
        setValidationData((prev) => ({
          ...prev,
          validating: false,
          validationFeedback: {
            status: 'error',
            message: response.reason || 'Invalid student ID',
          },
        }));
      }
    } catch (err) {
      const errorMessage = err.response?.data?.reason || err.response?.data?.message || 'Validation failed';
      setValidationData((prev) => ({
        ...prev,
        validating: false,
        validationFeedback: {
          status: 'error',
          message: errorMessage,
        },
      }));
    }
  };

  // Proceed to account creation step
  const handleProceedToAccountCreation = () => {
    if (validationData.validationFeedback.status === 'success') {
      setCurrentStep(2);
      setValidationErrors({});
    }
  };

  // Go back to student ID validation
  const handleBackToValidation = () => {
    setCurrentStep(1);
    setValidationErrors({});
  };

  // Validate registration form
  const validateRegistrationForm = () => {
    const errors = {};

    if (!registrationData.password) {
      errors.password = 'Password is required';
    } else if (!passwordStrength.isValid) {
      errors.password = 'Password does not meet strength requirements';
    }

    if (registrationData.password !== registrationData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle account creation
  const handleSubmitRegistration = async (e) => {
    e.preventDefault();

    if (!validateRegistrationForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await registerStudent(
        registrationData.validationToken,
        validationData.email,
        registrationData.password,
        registrationData.connectGithub
      );

      // Update auth store
      setAuth(
        {
          userId: response.userId,
          email: response.email,
          role: 'student',
          emailVerified: false,
          accountStatus: response.accountStatus,
        },
        response.accessToken,
        response.refreshToken
      );

      // If GitHub OAuth was requested, redirect to GitHub
      if (response.githubOauthUrl) {
        window.location.href = response.githubOauthUrl;
      } else {
        // Otherwise redirect to email verification
        navigate('/auth/verify-email');
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Registration failed';
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <h2>Create Your Account</h2>
        <p className="form-subtitle">Join the Senior Project Management System</p>

        {/* Progress Indicator */}
        <div className="progress-indicator">
          <div className={`progress-step ${currentStep >= 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}>
            <div className="step-number">1</div>
            <div className="step-label">Validate ID</div>
          </div>
          <div className="progress-line" />
          <div className={`progress-step ${currentStep >= 2 ? 'active' : ''}`}>
            <div className="step-number">2</div>
            <div className="step-label">Create Account</div>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* Step 1: Student ID Validation */}
        {currentStep === 1 && (
          <form onSubmit={handleValidateStudentId}>
            <h3>Step 1: Validate Your Student ID</h3>
            <p className="step-description">Please enter your student ID and email to verify your enrollment</p>

            {/* Student ID Input */}
            <div className="form-group">
              <label htmlFor="studentId">Student ID</label>
              <input
                type="text"
                id="studentId"
                name="studentId"
                value={validationData.studentId}
                onChange={handleValidationChange}
                placeholder="Enter your student ID"
                className={validationErrors.studentId ? 'input-error' : ''}
                disabled={validationData.validating}
              />
              {validationErrors.studentId && (
                <span className="error-message">{validationErrors.studentId}</span>
              )}
            </div>

            {/* Email Input */}
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                name="email"
                value={validationData.email}
                onChange={handleValidationChange}
                placeholder="you@university.edu"
                className={validationErrors.email ? 'input-error' : ''}
                disabled={validationData.validating}
              />
              {validationErrors.email && (
                <span className="error-message">{validationErrors.email}</span>
              )}
            </div>

            {/* Validation Feedback */}
            {validationData.validationFeedback.status && (
              <div className={`validation-feedback validation-${validationData.validationFeedback.status}`}>
                <span className="feedback-icon">
                  {validationData.validationFeedback.status === 'validating' && '⏳'}
                  {validationData.validationFeedback.status === 'success' && '✓'}
                  {validationData.validationFeedback.status === 'error' && '✗'}
                </span>
                <span className="feedback-message">{validationData.validationFeedback.message}</span>
              </div>
            )}

            {/* Validate Button */}
            <button
              type="submit"
              className="btn btn-submit"
              disabled={validationData.validating}
            >
              {validationData.validating ? 'Validating...' : 'Validate Student ID'}
            </button>

            {/* Proceed to Step 2 */}
            {validationData.validationFeedback.status === 'success' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleProceedToAccountCreation}
              >
                Proceed to Account Creation →
              </button>
            )}
          </form>
        )}

        {/* Step 2: Account Creation */}
        {currentStep === 2 && (
          <form onSubmit={handleSubmitRegistration}>
            <h3>Step 2: Create Your Account</h3>
            <p className="step-description">Set your password and complete your registration</p>

            {/* Email Display (Read-only) */}
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                value={validationData.email}
                disabled
                className="input-readonly"
              />
              <small>This email was verified in the previous step</small>
            </div>

            {/* Password Input */}
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={registrationData.password}
                onChange={handleRegistrationChange}
                placeholder="Create a strong password"
                className={validationErrors.password ? 'input-error' : ''}
                disabled={loading}
              />
              {!passwordStrength.isValid && registrationData.password && (
                <div className="password-requirements">
                  <p>Password requirements:</p>
                  <ul>
                    {passwordStrength.errors.map((error, index) => (
                      <li key={index}>✗ {error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {passwordStrength.isValid && registrationData.password && (
                <div className="password-requirements password-valid">
                  <p>✓ Password is strong</p>
                </div>
              )}
              {validationErrors.password && (
                <span className="error-message">{validationErrors.password}</span>
              )}
            </div>

            {/* Confirm Password Input */}
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={registrationData.confirmPassword}
                onChange={handleRegistrationChange}
                placeholder="Confirm your password"
                className={validationErrors.confirmPassword ? 'input-error' : ''}
                disabled={loading}
              />
              {registrationData.password && registrationData.confirmPassword && (
                <span className={registrationData.password === registrationData.confirmPassword ? 'success-message' : 'error-message'}>
                  {registrationData.password === registrationData.confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                </span>
              )}
              {validationErrors.confirmPassword && (
                <span className="error-message">{validationErrors.confirmPassword}</span>
              )}
            </div>

            {/* Connect GitHub */}
            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="connectGithub"
                name="connectGithub"
                checked={registrationData.connectGithub}
                onChange={handleRegistrationChange}
                disabled={loading}
              />
              <label htmlFor="connectGithub">Connect my GitHub account (optional)</label>
            </div>

            {/* Action Buttons */}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBackToValidation}
                disabled={loading}
              >
                ← Back
              </button>
              <button type="submit" className="btn btn-submit" disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </div>
          </form>
        )}

        {/* Links */}
        <div className="form-links">
          <p>
            Already have an account?{' '}
            <button type="button" className="link-button" onClick={() => navigate('/auth/login')}>
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterForm;
