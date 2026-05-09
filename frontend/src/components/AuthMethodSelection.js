import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { initiateGithubLogin } from '../api/authService';
import './AuthMethodSelection.css';

const IS_DEV = process.env.NODE_ENV === 'development';
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5002/api/v1';

const MOCK_GITHUB_USERS = [
  { label: 'Alice (Student)',   githubId: '10000001', role: 'student'     },
  { label: 'Bob (Student)',     githubId: '10000002', role: 'student'     },
  { label: 'Charlie (Student)', githubId: '10000003', role: 'student'     },
  { label: 'Prof. Advisor',     githubId: '10000004', role: 'professor'   },
  { label: 'Prof. Transfer',    githubId: '10000005', role: 'professor'   },
  { label: 'Coordinator',       githubId: '10000006', role: 'coordinator' },
  { label: 'Admin',             githubId: '10000007', role: 'admin'       },
];

/**
 * Auth Method Selection Screen
 * Allows user to choose between local login/registration and GitHub OAuth
 */
const AuthMethodSelection = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isRegistration = searchParams.get('register') === 'true';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLocalAuth = () => {
    setError('');
    if (isRegistration) {
      navigate('/onboarding');
    } else {
      navigate('/auth/login');
    }
  };

  const handleMockGithubLogin = (githubId) => {
    window.location.href = `${API_BASE}/auth/github/oauth/mock-login?githubId=${githubId}`;
  };

  const handleGithubOAuth = async () => {
    setError('');
    if (isRegistration) {
      navigate('/onboarding?connectGithub=true');
      return;
    }

    setLoading(true);
    try {
      const data = await initiateGithubLogin();
      window.location.href = data.authorizationUrl;
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start GitHub sign-in');
      setLoading(false);
    }
  };

  return (
    <div className="auth-method-selection">
      <div className="auth-container">
        <div className="auth-content">
          <h1>Senior Project Management System</h1>
          <p className="subtitle">
            {isRegistration ? 'Create your account' : 'Sign in to your account'}
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="auth-methods">
            {/* Local Authentication */}
            <div className="auth-method-card local-auth">
              <div className="method-icon">📧</div>
              <h2>Email & Password</h2>
              <p>Use your email address and a secure password</p>
              <button
                className="btn btn-primary"
                onClick={handleLocalAuth}
                disabled={loading}
              >
                Continue with Email
              </button>
            </div>

            {/* Divider */}
            <div className="divider">
              <span>or</span>
            </div>

            {/* GitHub OAuth */}
            <div className="auth-method-card github-auth">
              <div className="method-icon">🐙</div>
              <h2>GitHub</h2>
              <p>Sign in with your GitHub account</p>
              <button
                className="btn btn-github"
                onClick={handleGithubOAuth}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Continue with GitHub'}
              </button>
            </div>
          </div>

          {IS_DEV && !isRegistration && (
            <div style={{
              marginTop: '32px',
              padding: '20px 24px',
              background: '#fffbeb',
              border: '1px dashed #f59e0b',
              borderRadius: '8px',
              textAlign: 'left',
            }}>
              <p style={{ margin: '0 0 12px 0', fontWeight: '700', fontSize: '13px', color: '#92400e', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                ⚡ Dev — Mock GitHub Login
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {MOCK_GITHUB_USERS.map((u) => (
                  <button
                    key={u.githubId}
                    onClick={() => handleMockGithubLogin(u.githubId)}
                    style={{
                      padding: '6px 14px',
                      background: '#1f2937',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '5px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                    }}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
              <p style={{ margin: '10px 0 0 0', fontSize: '11px', color: '#b45309' }}>
                Requires seed data — run <code>node scripts/seed-test-general.js</code> first
              </p>
            </div>
          )}

          <div className="auth-footer">
            <p>
              {isRegistration ? (
                <>
                  Already have an account?{' '}
                  <button
                    className="link-button"
                    onClick={() => navigate('/auth/method-selection')}
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Don't have an account?{' '}
                  <button
                    className="link-button"
                    onClick={() => navigate('/auth/method-selection?register=true')}
                  >
                    Sign up
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthMethodSelection;
