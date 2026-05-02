import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useOnboardingStore, { STEPS } from '../../store/onboardingStore';
import useAuthStore from '../../store/authStore';
import {
  validateStudentId,
  sendVerificationEmail,
  verifyEmail,
  completeOnboarding,
} from '../../api/onboardingService';
import { registerStudent, getAccount } from '../../api/authService';
import { validatePasswordStrength } from '../../utils/passwordValidator';
import './OnboardingStepper.css';

const RESEND_COOLDOWN_SECONDS = 60;
const ROLE_REDIRECT = {
  student: '/dashboard',
  professor: '/dashboard',
  admin: '/dashboard',
  coordinator: '/dashboard',
};

// ─────────────────────────────────────────────
// Step 1: Validate Student ID
// ─────────────────────────────────────────────
const Step1 = ({ onNext, onBack }) => {
  const { setValidationToken, setEmail, setPassword, setStepComplete } = useOnboardingStore();
  const [form, setForm] = useState({ studentId: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [pwStrength, setPwStrength] = useState({ isValid: true, errors: [] });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: '' });
    if (e.target.name === 'password') setPwStrength(validatePasswordStrength(e.target.value));
  };

  const validate = () => {
    const errs = {};
    if (!form.studentId) errs.studentId = 'Student ID is required';
    if (!form.email) errs.email = 'Email is required';
    if (!form.password) errs.password = 'Password is required';
    else if (!pwStrength.isValid) errs.password = 'Password does not meet requirements';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError('');
    try {
      const data = await validateStudentId(form.studentId, form.email, form.password);
      setValidationToken(data.validationToken);
      setEmail(form.email);
      setPassword(form.password);
      setStepComplete('studentIdValidated');
      onNext();
    } catch (err) {
      const msg = err.response?.data?.reason || err.response?.data?.message || 'Validation failed';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2>Validate Student ID</h2>
      <p className="step-subtitle">Enter your institutional student ID to verify eligibility.</p>

      {apiError && <div className="alert alert-error">{apiError}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Student ID</label>
          <input name="studentId" value={form.studentId} onChange={handleChange}
            placeholder="e.g. STU-2025-001" className={errors.studentId ? 'input-error' : ''} />
          {errors.studentId && <span className="error-message">{errors.studentId}</span>}
        </div>
        <div className="form-group">
          <label>Email Address</label>
          <input name="email" type="email" value={form.email} onChange={handleChange}
            placeholder="you@university.edu" className={errors.email ? 'input-error' : ''} />
          {errors.email && <span className="error-message">{errors.email}</span>}
        </div>
        <div className="form-group">
          <label>Password</label>
          <input name="password" type="password" value={form.password} onChange={handleChange}
            placeholder="Min 8 chars, uppercase, number, symbol" className={errors.password ? 'input-error' : ''} />
          {!pwStrength.isValid && (
            <span className="password-hint">{pwStrength.errors[0]}</span>
          )}
          {errors.password && <span className="error-message">{errors.password}</span>}
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Validating...' : 'Validate & Continue'}
        </button>
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back to Login
        </button>
      </form>
    </>
  );
};

// ─────────────────────────────────────────────
// Step 2: Create Account
// ─────────────────────────────────────────────
const Step2 = ({ onNext, onBack }) => {
  const navigate = useNavigate();
  const { validationToken, email, password, userId, setUserId, setStepComplete, setEmailLastSentAt } =
    useOnboardingStore();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [accountExists, setAccountExists] = useState(false);
  const [done, setDone] = useState(!!userId);
  const autoRegisterFired = useRef(false);
  const registerInFlight = useRef(false);

  const handleRegister = async () => {
    if (registerInFlight.current) return;
    const { validationToken: vt, email: em, password: pw, userId: uid } = useOnboardingStore.getState();
    if (!vt || !em || !pw) {
      setApiError('Missing sign-up data. Go back, complete student validation, and try again.');
      return;
    }
    if (uid) {
      return;
    }
    registerInFlight.current = true;
    setLoading(true);
    setApiError('');
    try {
      const response = await registerStudent(vt, em, pw);
      setAuth(
        { userId: response.userId, email: response.email, role: 'student',
          groupId: response.groupId,
          activeGroupId: response.activeGroupId,
          currentGroupId: response.currentGroupId,
          emailVerified: false, accountStatus: response.accountStatus },
        response.accessToken,
        response.refreshToken
      );
      setUserId(response.userId);
      setStepComplete('accountCreated');
      // Trigger verification email
      try {
        await sendVerificationEmail(response.userId);
        setEmailLastSentAt(Date.now());
      } catch { /* non-critical */ }
      setDone(true);
    } catch (err) {
      const code = err.response?.data?.code;

      // Account already exists — recover gracefully instead of showing a dead-end error
      if (code === 'CONFLICT') {
        const existingAuth = useAuthStore.getState();
        if (existingAuth.isAuthenticated && existingAuth.user?.userId) {
          // Already registered and still authenticated from a previous run — resume the flow
          setUserId(existingAuth.user.userId);
          setStepComplete('accountCreated');
          if (!existingAuth.user.emailVerified) {
            try {
              await sendVerificationEmail(existingAuth.user.userId);
              setEmailLastSentAt(Date.now());
            } catch { /* non-critical */ }
          }
          setDone(true);
          return;
        }
        // Not authenticated — tell user to sign in
        setAccountExists(true);
        setApiError('An account with this email already exists.');
        return;
      }

      const msg = err.response?.data?.message || 'Registration failed';
      setApiError(msg);
    } finally {
      setLoading(false);
      registerInFlight.current = false;
    }
  };

  // Auto-register once token + password are available (incl. after zustand persist rehydration)
  useEffect(() => {
    if (autoRegisterFired.current || userId) return;
    if (!validationToken || !email || !password) return;
    autoRegisterFired.current = true;
    void handleRegister();
    // Intentionally omit handleRegister: stable behavior via getState() inside it + autoRegisterFired guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationToken, email, password, userId]);

  if (loading) {
    return (
      <>
        <h2>Creating Account</h2>
        <p className="step-subtitle">Please wait...</p>
        <div className="alert alert-info">Creating your account...</div>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h2>Account Created</h2>
        <p className="step-subtitle">Your account has been created successfully.</p>
        <div className="alert alert-success">
          Account created for <strong>{email}</strong>. A verification email has been sent.
        </div>
        <button className="btn-primary" onClick={onNext}>Continue to Email Verification</button>
      </>
    );
  }

  return (
    <>
      <h2>Create Account</h2>
      <p className="step-subtitle">Ready to create your account with email <strong>{email}</strong>.</p>
      {apiError && (
        <div className="alert alert-error">
          {apiError}
          {accountExists && (
            <span>
              {' '}
              <button
                type="button"
                className="link-button"
                onClick={() => navigate('/auth/login')}
              >
                Sign in instead
              </button>
            </span>
          )}
        </div>
      )}
      <button className="btn-primary" onClick={handleRegister} disabled={loading}>
        Create Account
      </button>
      <button className="btn-secondary" onClick={onBack} disabled={loading}>
        Back
      </button>
    </>
  );
};

// ─────────────────────────────────────────────
// Step 3: Verify Email
// ─────────────────────────────────────────────
const Step3 = ({ onNext, onBack, urlToken }) => {
  const { userId, email, setStepComplete, emailLastSentAt, setEmailLastSentAt } = useOnboardingStore();
  const { setUser } = useAuthStore();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [apiError, setApiError] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const autoVerifyOnce = useRef(false);

  // Compute initial countdown from emailLastSentAt stored in the onboarding store
  useEffect(() => {
    if (!emailLastSentAt) return;
    const elapsed = Math.floor((Date.now() - emailLastSentAt) / 1000);
    const remaining = RESEND_COOLDOWN_SECONDS - elapsed;
    if (remaining > 0) setSecondsLeft(remaining);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown tick
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const submitVerify = useCallback(
    async (t) => {
      const raw = t != null ? String(t).trim() : '';
      if (!raw) {
        setTokenError('Please enter the verification token');
        return;
      }
      setLoading(true);
      setApiError('');
      setTokenError('');
      try {
        const data = await verifyEmail(raw);
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
        const status = err.response?.status;
        // After a successful verify the server clears the token; a duplicate request (refresh/strict mode)
        // gets INVALID_TOKEN — recover by checking account if we are logged in.
        if ((code === 'INVALID_TOKEN' || code === 'MISSING_FIELDS') && status === 400) {
          const uid = useOnboardingStore.getState().userId;
          if (uid) {
            try {
              const acc = await getAccount(uid);
              if (acc.emailVerified) {
                setUser({ emailVerified: true, accountStatus: acc.accountStatus });
                setStepComplete('emailVerified');
                onNext();
                return;
              }
            } catch {
              /* fall through */
            }
          }
        }
        if (code === 'EXPIRED_TOKEN') {
          setApiError('Your verification link has expired. Please request a new one.');
        } else if (code === 'INVALID_TOKEN') {
          setApiError(
            'This verification link is invalid or was already used. If your email is already verified, continue to the dashboard or sign in again.'
          );
        } else {
          setApiError(err.response?.data?.message || 'Invalid token. Please check and try again.');
        }
      } finally {
        setLoading(false);
      }
    },
    [setUser, setStepComplete, onNext]
  );

  // Auto-verify when token comes from URL deep-link (once; trimmed; no empty POST)
  useEffect(() => {
    const raw = urlToken != null ? String(urlToken).trim() : '';
    if (!raw || autoVerifyOnce.current) return;
    autoVerifyOnce.current = true;
    void submitVerify(raw);
  }, [urlToken, submitVerify]);

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!token.trim()) { setTokenError('Please enter the verification token'); return; }
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
        <button className="btn-primary" onClick={onNext}>Continue</button>
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
        We sent a verification token to <strong>{email}</strong>. Check your inbox (or the backend console in dev mode).
      </p>

      {apiError && <div className="alert alert-error">{apiError}</div>}

      <form onSubmit={handleVerify}>
        <div className="form-group">
          <label>Verification Token</label>
          <input value={token} onChange={(e) => { setToken(e.target.value); setTokenError(''); }}
            placeholder="Paste token from email / backend console"
            className={tokenError ? 'input-error' : ''} />
          {tokenError && <span className="error-message">{tokenError}</span>}
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
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
        >
          {resending ? 'Sending...' : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend email'}
        </button>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────
// Step 4: Link GitHub (optional)
// ─────────────────────────────────────────────
const Step4 = ({ onFinish, onBack, autoStartGithub }) => {
  const { setStepComplete } = useOnboardingStore();
  const { user } = useAuthStore();
  const [autoStarted, setAutoStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleLinkGithub = useCallback(async () => {
    setLoading(true);
    setApiError('');
    try {
      const { initiateGithubOAuth } = await import('../../api/authService');
      const data = await initiateGithubOAuth(window.location.origin + '/auth/github/callback');
      window.location.href = data.authorizationUrl;
    } catch (err) {
      setApiError(err.response?.data?.message || 'Failed to initiate GitHub OAuth');
      setLoading(false);
    }
  }, [setApiError, setLoading]);

  useEffect(() => {
    if (autoStartGithub && !autoStarted) {
      setAutoStarted(true);
      handleLinkGithub();
    }
  }, [autoStartGithub, autoStarted, handleLinkGithub]);

  const handleSkip = async () => {
    setLoading(true);
    try {
      const { userId } = useOnboardingStore.getState();
      await completeOnboarding(userId);
      setStepComplete('githubLinked');
      onFinish();
    } catch {
      onFinish();
    }
  };

  return (
    <>
      <h2>Link GitHub <span className="optional-badge">optional</span></h2>
      <p className="step-subtitle">
        Connect your GitHub account to enable repository integration for your senior project.
      </p>

      {apiError && <div className="alert alert-error">{apiError}</div>}

      <button className="btn-github-link" onClick={handleLinkGithub} disabled={loading}>
        {loading ? 'Redirecting...' : 'Connect GitHub Account'}
      </button>

      <button className="btn-secondary" onClick={handleSkip} disabled={loading}>
        Skip for now
      </button>
      <button className="btn-secondary" onClick={onBack} disabled={loading}>
        Back
      </button>
    </>
  );
};

// ─────────────────────────────────────────────
// Main Stepper Component
// ─────────────────────────────────────────────
const OnboardingStepper = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    currentStep,
    completed,
    setCurrentStep,
    nextStep,
    previousStep,
    canNavigateTo,
    isFullyComplete,
    reset,
  } = useOnboardingStore();
  const { user } = useAuthStore();

  const urlToken = searchParams.get('step') === 'verify-email' ? searchParams.get('token') : null;
  const autoStartGithub = searchParams.get('connectGithub') === 'true';

  // Handle email verification deep-link: /onboarding?step=verify-email&token=xxx
  useEffect(() => {
    if (urlToken) {
      setCurrentStep(3);
    }
  }, [urlToken, setCurrentStep]);

  const handleFinish = (role) => {
    reset();
    const redirect = ROLE_REDIRECT[role] || '/dashboard';
    navigate(redirect);
  };

  const handleCompleteAndFinish = async () => {
    try {
      const { userId } = useOnboardingStore.getState();
      const account = await completeOnboarding(userId);
      handleFinish(account.role || user?.role || 'student');
    } catch {
      handleFinish(user?.role || 'student');
    }
  };

  const getStepStatus = (stepId) => {
    const key = STEPS[stepId - 1].key;
    if (completed[key]) return 'completed';
    if (stepId === currentStep) return 'active';
    return 'locked';
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1 onNext={nextStep} onBack={() => navigate('/auth/method-selection')} />;
      case 2:
        return <Step2 onNext={nextStep} onBack={previousStep} />;
      case 3:
        return <Step3 onNext={nextStep} onBack={previousStep} urlToken={urlToken} />;
      case 4:
        return <Step4 onFinish={handleCompleteAndFinish} onBack={previousStep} autoStartGithub={autoStartGithub} />;
      default:
        return null;
    }
  };

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {/* Stepper Header */}
        <div className="stepper-header">
          {STEPS.map((step) => {
            const status = getStepStatus(step.id);
            const clickable = canNavigateTo(step.id) && status !== 'active';
            return (
              <div
                key={step.id}
                className={`step-indicator ${status} ${clickable ? 'clickable' : ''}`}
                onClick={() => clickable && setCurrentStep(step.id)}
              >
                <div className="step-circle">
                  {status === 'completed' ? '✓' : step.id}
                </div>
                <span className="step-label">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="step-content">
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default OnboardingStepper;
