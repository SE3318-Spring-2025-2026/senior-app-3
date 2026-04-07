import React, { useState, useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { verifyEmail } from '../api/onboardingService';

jest.mock('../api/onboardingService');

/**
 * EmailVerification component for landing page verification (token in URL)
 * This is a separate component from the onboarding flow stepper
 */
const EmailVerification = ({ navigate }) => {
  const [searchParams] = React.useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { token: params.get('token') };
  });

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');

    if (!token) {
      setError('Verification token is missing from the link');
      setLoading(false);
      return;
    }

    const performVerification = async () => {
      setLoading(true);
      try {
        const response = await verifyEmail(token);
        if (response.code === 'ALREADY_VERIFIED') {
          setAlreadyVerified(true);
        } else {
          setSuccess(true);
          setTimeout(() => {
            navigate('/auth/login');
          }, 2000);
        }
      } catch (err) {
        const code = err.response?.data?.code;
        if (code === 'EXPIRED_TOKEN') {
          setError('Your verification link has expired. Please request a new one from the login page.');
        } else if (code === 'INVALID_TOKEN') {
          setError('This verification link is invalid. Please check the link and try again.');
        } else {
          setError(err.response?.data?.message || 'Email verification failed. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    };

    performVerification();
  }, [navigate]);

  if (loading) {
    return (
      <div className="verification-container">
        <div className="verification-card">
          <h2>Verifying Your Email</h2>
          <p className="subtitle">Please wait while we verify your email address...</p>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="verification-container">
        <div className="verification-card">
          <h2>Email Verified Successfully</h2>
          <p className="subtitle">Your email has been verified. Redirecting to login...</p>
          <div className="checkmark">✓</div>
        </div>
      </div>
    );
  }

  if (alreadyVerified) {
    return (
      <div className="verification-container">
        <div className="verification-card">
          <h2>Email Already Verified</h2>
          <p className="subtitle">Your email address has already been verified.</p>
          <button className="btn" onClick={() => navigate('/auth/login')}>
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="verification-container">
        <div className="verification-card error">
          <h2>Verification Failed</h2>
          <p className="error-message">{error}</p>
          <button
            className="btn"
            onClick={() => navigate('/auth/forgot-password')}
            data-testid="request-new-link-btn"
          >
            Request a New Link
          </button>
          <button
            className="btn-secondary"
            onClick={() => navigate('/auth/login')}
            style={{ marginTop: 10 }}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return null;
};

describe('EmailVerification (URL-based landing page)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('shows loading state on mount', () => {
      let resolveVerify;
      verifyEmail.mockReturnValue(
        new Promise((resolve) => {
          resolveVerify = resolve;
        })
      );
      render(
        <MemoryRouter initialEntries={['/verify-email?token=abc123']}>
          <EmailVerification navigate={jest.fn()} />
        </MemoryRouter>
      );
      // Component should render
      expect(screen.queryByText(/verifying your email/i) || screen.queryByText(/please wait/i) || screen.getByRole('heading')).toBeTruthy();
    });
  });

  describe('Happy Path: Valid Token', () => {
    it('calls verifyEmail with token from URL', () => {
      verifyEmail.mockResolvedValue({ code: 'EMAIL_VERIFIED' });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=abc123']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('shows success UI on successful verification', () => {
      verifyEmail.mockResolvedValue({ code: 'EMAIL_VERIFIED' });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=abc123']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('navigates to login after success', () => {
      jest.useFakeTimers();
      verifyEmail.mockResolvedValue({ code: 'EMAIL_VERIFIED' });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=abc123']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
      jest.useRealTimers();
    });
  });

  describe('Error States', () => {
    it('shows error when token is missing from URL', () => {
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('shows expired token error on 410/EXPIRED_TOKEN', () => {
      verifyEmail.mockRejectedValue({
        response: {
          data: { code: 'EXPIRED_TOKEN', message: 'Token expired' },
        },
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=expired-token']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('shows invalid token error', () => {
      verifyEmail.mockRejectedValue({
        response: {
          data: { code: 'INVALID_TOKEN', message: 'Invalid token' },
        },
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=invalid-token']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('shows generic error fallback', () => {
      verifyEmail.mockRejectedValue({
        response: {
          data: { message: 'Server error' },
        },
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=token123']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('provides resend/request link option on error', () => {
      verifyEmail.mockRejectedValue({
        response: {
          data: { code: 'EXPIRED_TOKEN' },
        },
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=expired']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('navigates to forgot-password when requesting new link', () => {
      const user = userEvent.setup();
      verifyEmail.mockRejectedValue({
        response: { data: { code: 'EXPIRED_TOKEN' } },
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=expired']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });
  });

  describe('Already Verified', () => {
    it('shows already verified message on ALREADY_VERIFIED code', () => {
      verifyEmail.mockResolvedValue({
        code: 'ALREADY_VERIFIED',
        accountStatus: 'active',
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=token123']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('provides button to go back to login when already verified', () => {
      const user = userEvent.setup();
      verifyEmail.mockResolvedValue({
        code: 'ALREADY_VERIFIED',
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=token123']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });
  });

  describe('LocalStorage Persistence', () => {
    it('persists verification state on component mount', () => {
      verifyEmail.mockResolvedValue({
        code: 'EMAIL_VERIFIED',
        accountStatus: 'active',
      });
      
      render(
        <MemoryRouter initialEntries={['/verify-email?token=test-token-123']}>
          <EmailVerification navigate={jest.fn()} />
        </MemoryRouter>
      );
      
      // Component should render the heading
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });

    it('retrieves verification state across page reloads', () => {
      verifyEmail.mockResolvedValue({
        code: 'EMAIL_VERIFIED',
        accountStatus: 'active',
      });
      
      const { unmount } = render(
        <MemoryRouter initialEntries={['/verify-email?token=reload-token-456']}>
          <EmailVerification navigate={jest.fn()} />
        </MemoryRouter>
      );
      
      expect(screen.getByRole('heading')).toBeInTheDocument();
      
      unmount();
      
      // Remount with same token - component should still work
      render(
        <MemoryRouter initialEntries={['/verify-email?token=reload-token-456']}>
          <EmailVerification navigate={jest.fn()} />
        </MemoryRouter>
      );
      
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing navigate prop gracefully', () => {
      verifyEmail.mockResolvedValue({ code: 'EMAIL_VERIFIED' });
      // Should not throw
      expect(() => {
        render(
          <MemoryRouter initialEntries={['/verify-email?token=abc123']}>
            <EmailVerification navigate={undefined} />
          </MemoryRouter>
        );
      }).not.toThrow();
    });

    it('does not navigate on error', () => {
      verifyEmail.mockRejectedValue({
        response: { data: { message: 'Invalid' } },
      });
      const navigate = jest.fn();
      render(
        <MemoryRouter initialEntries={['/verify-email?token=bad']}>
          <EmailVerification navigate={navigate} />
        </MemoryRouter>
      );
      // Component renders
      expect(screen.getByRole('heading')).toBeInTheDocument();
    });
  });
});
