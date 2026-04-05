import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestPasswordReset } from '../api/authService';
import './AuthForms.css';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const validateEmail = (value) => {
    if (!value) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(email);
    } catch {
      // Silently ignore — non-revealing by design
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="auth-form-container">
        <div className="auth-form">
          <h2>Check Your Email</h2>
          <p className="form-subtitle">
            If an account exists for <strong>{email}</strong>, a reset link has been sent. Check
            your inbox — the link expires in 15 minutes.
          </p>
          <div className="form-links">
            <button type="button" className="link-button" onClick={() => navigate('/auth/login')}>
              Back to Sign In
            </button>
            <span>•</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setSubmitted(false);
                setEmail('');
              }}
            >
              Try a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-form-container">
      <div className="auth-form">
        <h2>Forgot Password</h2>
        <p className="form-subtitle">
          Enter your email and we'll send you a reset link valid for 15 minutes.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
              }}
              placeholder="you@university.edu"
              className={emailError ? 'input-error' : ''}
              disabled={loading}
            />
            {emailError && <span className="error-message">{emailError}</span>}
          </div>

          <button type="submit" className="btn btn-submit" disabled={loading}>
            {loading ? 'Sending...' : 'Send Reset Link'}
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

export default ForgotPasswordPage;
