import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { registerStudent } from '../api/authService';
import { validatePasswordStrength } from '../utils/passwordValidator';
import './AuthForms.css';

/**
 * Registration Form Component
 */
const RegisterForm = () => {
  const navigate = useNavigate();
  const { setAuth, setError, error } = useAuthStore();

  const [formData, setFormData] = useState({
    validationToken: '', // From student ID validation
    email: '',
    password: '',
    confirmPassword: '',
    connectGithub: false,
  });
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [passwordStrength, setPasswordStrength] = useState({
    isValid: true,
    errors: [],
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
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

  const validateForm = () => {
    const errors = {};

    if (!formData.email) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (!passwordStrength.isValid) {
      errors.password = 'Password does not meet strength requirements';
    }

    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.validationToken) {
      errors.validationToken = 'Please validate your student ID first';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await registerStudent(
        formData.validationToken,
        formData.email,
        formData.password,
        formData.connectGithub
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
        // Otherwise redirect to email verification or dashboard
        navigate('/auth/verify-email');
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Registration failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <h2>Create Your Account</h2>
        <p className="form-subtitle">Join the Senior Project Management System</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Email Input */}
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@university.edu"
              className={validationErrors.email ? 'input-error' : ''}
              disabled={loading}
            />
            {validationErrors.email && (
              <span className="error-message">{validationErrors.email}</span>
            )}
          </div>

          {/* Password Input */}
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Create a strong password"
              className={validationErrors.password ? 'input-error' : ''}
              disabled={loading}
            />
            {!passwordStrength.isValid && (
              <div className="password-requirements">
                <p>Password requirements:</p>
                <ul>
                  {passwordStrength.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
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
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Confirm your password"
              className={validationErrors.confirmPassword ? 'input-error' : ''}
              disabled={loading}
            />
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
              checked={formData.connectGithub}
              onChange={handleChange}
              disabled={loading}
            />
            <label htmlFor="connectGithub">Connect my GitHub account (optional)</label>
          </div>

          {/* Validation Token */}
          <div className="form-group">
            <label htmlFor="validationToken">Student ID Validation Token</label>
            <input
              type="text"
              id="validationToken"
              name="validationToken"
              value={formData.validationToken}
              onChange={handleChange}
              placeholder="Paste your validation token"
              className={validationErrors.validationToken ? 'input-error' : ''}
              disabled={loading}
            />
            {validationErrors.validationToken && (
              <span className="error-message">{validationErrors.validationToken}</span>
            )}
            <small>
              Get this token from the{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => navigate('/auth/validate-student-id')}
              >
                student ID validation
              </button>{' '}
              page
            </small>
          </div>

          {/* Submit Button */}
          <button type="submit" className="btn btn-submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

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
