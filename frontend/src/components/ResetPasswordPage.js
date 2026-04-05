import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset, validatePasswordResetToken } from '../api/authService';
import { validatePasswordStrength } from '../utils/passwordValidator';
import './AuthForms.css';

const PasswordStrengthBar = ({ password }) => {
  if (!password) return null;
  const { errors } = validatePasswordStrength(password);
  const passed = 5 - errors.length;
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60'];

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= passed ? colors[passed - 1] : '#e0e0e0',
              transition: 'background-color 0.2s',
            }}
          />
        ))}
      </div>
      {passed < 5 && (
        <small style={{ color: colors[passed - 1] || '#999' }}>
          {passed === 0 ? 'Very Weak' : labels[passed - 1]}
          {errors.length > 0 && `: ${errors[0]}`}
        </small>
      )}
      {passed === 5 && <small style={{ color: '#27ae60' }}>Strong password</small>}
    </div>
  );
};

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [formData, setFormData] = useState({ newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [success, setSuccess] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError(true);
      setValidating(false);
      return;
    }
    validatePasswordResetToken(token)
      .then(() => setValidating(false))
      .catch(() => {
        setTokenError(true);
        setValidating(false);
      });
  }, [token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors = {};
    const { isValid, errors: strengthErrors } = validatePasswordStrength(formData.newPassword);
    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (!isValid) {
      newErrors.newPassword = strengthErrors[0];
    }
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await confirmPasswordReset(token, formData.newPassword);
      setSuccess(true);
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'INVALID_TOKEN') {
        setTokenError(true);
      } else if (code === 'WEAK_PASSWORD') {
        setErrors({ newPassword: err.response.data.details?.[0] || 'Password too weak' });
      } else {
        setErrors({ submit: err.response?.data?.message || 'Reset failed. Please try again.' });
      }
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="auth-form-container">
        <div className="auth-form" style={{ textAlign: 'center' }}>
          <p className="form-subtitle">Validating reset link…</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="auth-form-container">
        <div className="auth-form">
          <h2>Password Updated</h2>
          <p className="form-subtitle">
            Your password has been changed successfully. All previous sessions have been signed out.
          </p>
          <button
            type="button"
            className="btn btn-submit"
            onClick={() => navigate('/auth/login')}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="auth-form-container">
        <div className="auth-form">
          <h2>Link Expired</h2>
          <p className="form-subtitle">
            This password reset link is invalid or has expired (links are valid for 15 minutes).
          </p>
          <button
            type="button"
            className="btn btn-submit"
            onClick={() => navigate('/auth/forgot-password')}
          >
            Request a New Link
          </button>
          <div className="form-links">
            <button
              type="button"
              className="link-button"
              onClick={() => navigate('/auth/login')}
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <h2>Reset Password</h2>
        <p className="form-subtitle">Enter your new password below.</p>

        {errors.submit && <div className="alert alert-error">{errors.submit}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              name="newPassword"
              value={formData.newPassword}
              onChange={handleChange}
              placeholder="Min 8 chars, upper, lower, digit, symbol"
              className={errors.newPassword ? 'input-error' : ''}
              disabled={loading}
            />
            <PasswordStrengthBar password={formData.newPassword} />
            {errors.newPassword && (
              <span className="error-message">{errors.newPassword}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Re-enter your new password"
              className={errors.confirmPassword ? 'input-error' : ''}
              disabled={loading}
            />
            {errors.confirmPassword && (
              <span className="error-message">{errors.confirmPassword}</span>
            )}
          </div>

          <button type="submit" className="btn btn-submit" disabled={loading}>
            {loading ? 'Updating...' : 'Set New Password'}
          </button>
        </form>

        <div className="form-links">
          <button type="button" className="link-button" onClick={() => navigate('/auth/login')}>
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
