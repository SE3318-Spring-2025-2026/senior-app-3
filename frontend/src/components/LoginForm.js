import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { loginUser } from '../api/authService';
import './AuthForms.css';

/**
 * Login Form Component
 */
const LoginForm = () => {
  const navigate = useNavigate();
  const { setAuth, setError, error } = useAuthStore();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [loading, setLocalLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear field error when user starts typing
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
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
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLocalLoading(true);
    setError(null);

    try {
      const response = await loginUser(formData.email, formData.password);

      // Update auth store
      setAuth(
        {
          userId: response.userId,
          email: response.email,
          role: response.role,
          emailVerified: response.emailVerified,
          accountStatus: response.accountStatus,
        },
        response.accessToken,
        response.refreshToken
      );

      // Redirect to dashboard
      navigate('/dashboard');
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Login failed';
      setError(errorMessage);
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <h2>Sign In</h2>
        <p className="form-subtitle">Welcome back to Senior Project Management System</p>

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
              placeholder="Enter your password"
              className={validationErrors.password ? 'input-error' : ''}
              disabled={loading}
            />
            {validationErrors.password && (
              <span className="error-message">{validationErrors.password}</span>
            )}
          </div>

          {/* Remember Me */}
          <div className="form-group checkbox">
            <input type="checkbox" id="remember" name="remember" />
            <label htmlFor="remember">Remember me</label>
          </div>

          {/* Submit Button */}
          <button type="submit" className="btn btn-submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Links */}
        <div className="form-links">
          <button
            type="button"
            className="link-button"
            onClick={() => navigate('/auth/forgot-password')}
          >
            Forgot password?
          </button>
          <span>•</span>
          <button
            type="button"
            className="link-button"
            onClick={() => navigate('/auth/method-selection?register=true')}
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
