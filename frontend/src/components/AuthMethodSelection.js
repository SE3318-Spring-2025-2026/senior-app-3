import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './AuthMethodSelection.css';

/**
 * Auth Method Selection Screen
 * Allows user to choose between local login/registration and GitHub OAuth
 */
const AuthMethodSelection = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isRegistration = searchParams.get('register') === 'true';
  const [loading, setLoading] = useState(false);

  // Log for debugging
  useEffect(() => {
    console.log('isRegistration:', isRegistration, 'URL:', window.location.href);
  }, [isRegistration]);

  const handleLocalAuth = () => {
    if (isRegistration) {
      navigate('/onboarding');
    } else {
      navigate('/auth/login');
    }
  };

  const handleGithubOAuth = () => {
    setLoading(true);
    // TODO: Implement GitHub OAuth flow
    // For now, navigate to a placeholder
    navigate('/auth/github-oauth');
  };

  return (
    <div className="auth-method-selection">
      <div className="auth-container">
        <div className="auth-content">
          <h1>Senior Project Management System</h1>
          <p className="subtitle">
            {isRegistration ? 'Create your account' : 'Sign in to your account'}
          </p>

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
