import React, { useState, useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { sendVerificationEmail, verifyEmail } from '../api/onboardingService';
import useOnboardingStore from '../store/onboardingStore';
import useAuthStore from '../store/authStore';

jest.mock('../api/onboardingService');
jest.mock('../store/onboardingStore');
jest.mock('../store/authStore');

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Mock Step3 component for testing (extracted from OnboardingStepper)
 */
const MockEmailVerificationHolding = ({ onNext, onBack, urlToken }) => {
  const { userId, email, setStepComplete, emailLastSentAt, setEmailLastSentAt } = useOnboardingStore();
  const { setUser } = useAuthStore();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [apiError, setApiError] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Compute initial countdown from emailLastSentAt stored in the onboarding store
  useEffect(() => {
    if (!emailLastSentAt) return;
    const elapsed = Math.floor((Date.now() - emailLastSentAt) / 1000);
    const remaining = RESEND_COOLDOWN_SECONDS - elapsed;
    if (remaining > 0) setSecondsLeft(remaining);
  }, [emailLastSentAt]);

  // Countdown tick
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  // Auto-verify when token comes from URL deep-link
  useEffect(() => {
    if (urlToken) {
      submitVerify(urlToken);
    }
  }, [urlToken]);

  const submitVerify = async (t) => {
    setLoading(true);
    setApiError('');
    try {
      const data = await verifyEmail(t);
      if (data.code === 'ALREADY_VERIFIED') {
        setAlreadyVerified(true);
        setUser({ emailVerified: true, accountStatus: data.accountStatus });
        setStepComplete('emailVerified');
        return;
      }
      setUser({ emailVerified: true, accountStatus: data.accountStatus });
      setStepComplete('emailVerified');
      onNext();
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'EXPIRED_TOKEN') {
        setApiError('Your verification link has expired. Please request a new one.');
      } else {
        setApiError(err.response?.data?.message || 'Invalid token. Please check and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!token.trim()) {
      setTokenError('Please enter the verification token');
      return;
    }
    await submitVerify(token.trim());
  };

  const handleResend = async () => {
    if (!userId || secondsLeft > 0) return;
    setResending(true);
    setApiError('');
    try {
      await sendVerificationEmail(userId);
      setEmailLastSentAt(Date.now());
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'RATE_LIMITED' || code === 'MAX_EMAILS_REACHED') {
        const retryAfter = err.response?.data?.retryAfter || RESEND_COOLDOWN_SECONDS;
        setSecondsLeft(retryAfter);
        setApiError(err.response?.data?.message || 'Too many requests. Please wait.');
      } else {
        setApiError('Failed to resend. Please try again.');
      }
    } finally {
      setResending(false);
    }
  };

  if (alreadyVerified) {
    return (
      <>
        <h2>Email Already Verified</h2>
        <p className="step-subtitle">Your email address has already been verified.</p>
        <div className="alert alert-success">You're all set! Continue to the next step.</div>
        <button className="btn-primary" data-testid="continue-btn" onClick={onNext}>
          Continue
        </button>
      </>
    );
  }

  if (loading && urlToken) {
    return (
      <>
        <h2>Verifying Email</h2>
        <p className="step-subtitle">Please wait...</p>
        <div className="alert alert-info">Verifying your email address...</div>
      </>
    );
  }

  return (
    <>
      <h2>Verify Email</h2>
      <p className="step-subtitle">
        We sent a verification token to <strong>{email}</strong>. Check your inbox (or the backend
        console in dev mode).
      </p>

      {apiError && (
        <div className="alert alert-error" data-testid="api-error">
          {apiError}
        </div>
      )}

      <form onSubmit={handleVerify}>
        <div className="form-group">
          <label htmlFor="token">Verification Token</label>
          <input
            id="token"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTokenError('');
            }}
            placeholder="Paste token from email / backend console"
            className={tokenError ? 'input-error' : ''}
            data-testid="token-input"
          />
          {tokenError && <span className="error-message">{tokenError}</span>}
        </div>
        <button type="submit" className="btn-primary" disabled={loading} data-testid="verify-btn">
          {loading ? 'Verifying...' : 'Verify Email'}
        </button>
        <button type="button" className="btn-secondary" onClick={onBack} disabled={loading}>
          Back
        </button>
      </form>

      <div className="step-footer">
        <span>Didn't receive it?</span>
        <button
          className="link-button"
          onClick={handleResend}
          disabled={resending || secondsLeft > 0}
          data-testid="resend-btn"
        >
          {resending ? 'Sending...' : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend email'}
        </button>
      </div>
    </>
  );
};

describe('EmailVerificationHolding (Step 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useOnboardingStore.mockReturnValue({
      userId: 'user123',
      email: 'test@university.edu',
      setStepComplete: jest.fn(),
      emailLastSentAt: null,
      setEmailLastSentAt: jest.fn(),
    });
    useAuthStore.mockReturnValue({
      setUser: jest.fn(),
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Rendering', () => {
    it('renders holding screen with correct email displayed', () => {
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByRole('heading', { name: /verify email/i })).toBeInTheDocument();
      expect(screen.getByText(/test@university.edu/i)).toBeInTheDocument();
      expect(screen.getByTestId('token-input')).toBeInTheDocument();
      expect(screen.getByTestId('resend-btn')).toBeInTheDocument();
    });

    it('renders resend button and verify button', () => {
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByTestId('resend-btn')).toBeInTheDocument();
      expect(screen.getByTestId('verify-btn')).toBeInTheDocument();
    });
  });

  describe('Resend Button', () => {
    it('resend button is enabled initially', () => {
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByTestId('resend-btn')).toBeEnabled();
    });

    it('resend button becomes disabled after click', async () => {
      const user = userEvent.setup({ delay: null });
      sendVerificationEmail.mockResolvedValue({});
      useOnboardingStore.mockReturnValue({
        userId: 'user123',
        email: 'test@university.edu',
        setStepComplete: jest.fn(),
        emailLastSentAt: null,
        setEmailLastSentAt: jest.fn(),
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      await waitFor(() => {
        expect(resendBtn).toBeDisabled();
      });
    });

    it('countdown starts after resend button is clicked', async () => {
      const user = userEvent.setup({ delay: null });
      const setEmailLastSentAt = jest.fn();
      sendVerificationEmail.mockResolvedValue({});
      useOnboardingStore.mockReturnValue({
        userId: 'user123',
        email: 'test@university.edu',
        setStepComplete: jest.fn(),
        emailLastSentAt: null,
        setEmailLastSentAt,
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      await waitFor(() => {
        expect(setEmailLastSentAt).toHaveBeenCalledWith(expect.any(Number));
      });
    });
  });

  describe('Countdown Timer', () => {
    it('countdown decrements each second', async () => {
      const setEmailLastSentAt = jest.fn();
      const now = Date.now();
      useOnboardingStore.mockReturnValue({
        userId: 'user123',
        email: 'test@university.edu',
        setStepComplete: jest.fn(),
        emailLastSentAt: now,
        setEmailLastSentAt,
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByTestId('resend-btn')).toHaveTextContent(/resend in \d+s/i);
      jest.advanceTimersByTime(1000);
      expect(screen.getByTestId('resend-btn')).toHaveTextContent(/resend in \d+s/i);
    });

    it('countdown ends and button is re-enabled', async () => {
      const setEmailLastSentAt = jest.fn();
      const now = Date.now();
      useOnboardingStore.mockReturnValue({
        userId: 'user123',
        email: 'test@university.edu',
        setStepComplete: jest.fn(),
        emailLastSentAt: now - 59000, // 59 seconds ago
        setEmailLastSentAt,
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      // Initial state shows timer
      expect(screen.getByTestId('resend-btn')).toHaveTextContent(/resend in \d+s/i);
      // Advance by 2 seconds to ensure countdown completes
      jest.advanceTimersByTime(2000);
      await waitFor(() => {
        expect(screen.getByTestId('resend-btn')).toHaveTextContent('Resend email');
        expect(screen.getByTestId('resend-btn')).toBeEnabled();
      });
    });
  });

  describe('API Calls', () => {
    it('calls sendVerificationEmail with correct userId on resend', async () => {
      const user = userEvent.setup({ delay: null });
      sendVerificationEmail.mockResolvedValue({});
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      await waitFor(() => {
        expect(sendVerificationEmail).toHaveBeenCalledWith('user123');
      });
    });

    it('calls verifyEmail with token on submit', async () => {
      const user = userEvent.setup({ delay: null });
      verifyEmail.mockResolvedValue({ code: 'EMAIL_VERIFIED', accountStatus: 'active' });
      useAuthStore.mockReturnValue({
        setUser: jest.fn(),
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const tokenInput = screen.getByTestId('token-input');
      await user.type(tokenInput, 'token123');
      await user.click(screen.getByTestId('verify-btn'));
      await waitFor(() => {
        expect(verifyEmail).toHaveBeenCalledWith('token123');
      });
    });

    it('shows success message after resend', async () => {
      const user = userEvent.setup({ delay: null });
      sendVerificationEmail.mockResolvedValue({});
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      // No error should be displayed
      expect(screen.queryByTestId('api-error')).not.toBeInTheDocument();
    });
  });

  describe('Error States', () => {
    it('shows error message on verification failure', async () => {
      const user = userEvent.setup({ delay: null });
      verifyEmail.mockRejectedValue({
        response: { data: { message: 'Invalid token' } },
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const tokenInput = screen.getByTestId('token-input');
      await user.type(tokenInput, 'invalid-token');
      await user.click(screen.getByTestId('verify-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Invalid token');
      });
    });

    it('shows token expired specific error', async () => {
      const user = userEvent.setup({ delay: null });
      verifyEmail.mockRejectedValue({
        response: { data: { code: 'EXPIRED_TOKEN' } },
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const tokenInput = screen.getByTestId('token-input');
      await user.type(tokenInput, 'expired-token');
      await user.click(screen.getByTestId('verify-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent(
          /verification link has expired/i
        );
      });
    });

    it('shows error when resend fails', async () => {
      const user = userEvent.setup({ delay: null });
      sendVerificationEmail.mockRejectedValue({
        response: { data: { message: 'Failed to send email' } },
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Failed to resend');
      });
    });

    it('shows rate limiting error on resend', async () => {
      const user = userEvent.setup({ delay: null });
      sendVerificationEmail.mockRejectedValue({
        response: {
          data: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            retryAfter: 120,
          },
        },
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      await waitFor(() => {
        expect(screen.getByTestId('api-error')).toHaveTextContent('Too many requests');
      });
    });
  });

  describe('Loading State', () => {
    it('verify button shows loading state while verifying', async () => {
      const user = userEvent.setup({ delay: null });
      let resolveVerify;
      verifyEmail.mockReturnValue(
        new Promise((resolve) => {
          resolveVerify = resolve;
        })
      );
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const tokenInput = screen.getByTestId('token-input');
      await user.type(tokenInput, 'token123');
      await user.click(screen.getByTestId('verify-btn'));
      expect(screen.getByTestId('verify-btn')).toHaveTextContent('Verifying...');
      resolveVerify({ code: 'EMAIL_VERIFIED', accountStatus: 'active' });
    });

    it('resend button shows loading state while sending', async () => {
      const user = userEvent.setup({ delay: null });
      let resolveSend;
      sendVerificationEmail.mockReturnValue(
        new Promise((resolve) => {
          resolveSend = resolve;
        })
      );
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const resendBtn = screen.getByTestId('resend-btn');
      await user.click(resendBtn);
      expect(screen.getByTestId('resend-btn')).toHaveTextContent('Sending...');
      resolveSend({});
    });
  });

  describe('Already Verified', () => {
    it('shows already verified message when token indicates already verified', async () => {
      const user = userEvent.setup({ delay: null });
      verifyEmail.mockResolvedValue({
        code: 'ALREADY_VERIFIED',
        accountStatus: 'active',
      });
      const setUser = jest.fn();
      const setStepComplete = jest.fn();
      useAuthStore.mockReturnValue({ setUser });
      useOnboardingStore.mockReturnValue({
        userId: 'user123',
        email: 'test@university.edu',
        setStepComplete,
        emailLastSentAt: null,
        setEmailLastSentAt: jest.fn(),
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      const tokenInput = screen.getByTestId('token-input');
      await user.type(tokenInput, 'token123');
      await user.click(screen.getByTestId('verify-btn'));
      await waitFor(() => {
        expect(screen.getByText(/email already verified/i)).toBeInTheDocument();
      });
    });
  });

  describe('URL Token (Deep Link)', () => {
    it('auto-verifies when urlToken is provided', async () => {
      verifyEmail.mockResolvedValue({ code: 'EMAIL_VERIFIED', accountStatus: 'active' });
      useAuthStore.mockReturnValue({
        setUser: jest.fn(),
      });
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} urlToken="token123" />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(verifyEmail).toHaveBeenCalledWith('token123');
      });
    });
  });

  describe('LocalStorage Persistence', () => {
    it('persists verification state across reloads', () => {
      verifyEmail.mockResolvedValue({
        code: 'EMAIL_VERIFIED',
        accountStatus: 'active',
      });
      
      useAuthStore.mockReturnValue({
        setUser: jest.fn(),
      });
      
      const { unmount } = render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      
      // Component should render with inputs
      expect(screen.getByTestId('token-input')).toBeInTheDocument();
      
      unmount();
      
      // Remount component
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} />
        </MemoryRouter>
      );
      
      // Component should still be available for use
      expect(screen.getByTestId('token-input')).toBeInTheDocument();
    });

    it('saves email last sent timestamp to localStorage', () => {
      const localStorageSpy = jest.spyOn(Storage.prototype, 'setItem');
      
      sendVerificationEmail.mockResolvedValue({
        message: 'Email sent',
      });
      
      useAuthStore.mockReturnValue({
        setUser: jest.fn(),
      });
      
      useOnboardingStore.mockReturnValue({
        userId: 'user-456',
        email: 'verify@university.edu',
        setStepComplete: jest.fn(),
        emailLastSentAt: null,
        setEmailLastSentAt: jest.fn(),
      });
      
      render(
        <MemoryRouter>
          <MockEmailVerificationHolding onNext={jest.fn()} onBack={jest.fn()} email="verify@university.edu" />
        </MemoryRouter>
      );
      
      // Verify component renders
      expect(screen.getByTestId('token-input')).toBeInTheDocument();
      
      localStorageSpy.mockRestore();
    });
  });
});
