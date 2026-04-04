import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useOnboardingStore, { STEPS } from '../../store/onboardingStore';
import useAuthStore from '../../store/authStore';
import {
  validateStudentId,
  sendVerificationEmail,
  verifyEmail,
  completeOnboarding,
} from '../../api/onboardingService';
import { registerStudent } from '../../api/authService';
import { validatePasswordStrength } from '../../utils/passwordValidator';
import './OnboardingStepper.css';

const ROLE_REDIRECT = {
  student:          '/dashboard',
  professor:        '/dashboard',
  admin:            '/dashboard',
  committee_member: '/dashboard',
};

// ─────────────────────────────────────────────
// Step 1: Validate Student ID
// ─────────────────────────────────────────────
const Step1 = ({ onNext }) => {
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
      </form>
    </>
  );
};

// ─────────────────────────────────────────────
// Step 2: Create Account
// ─────────────────────────────────────────────
const Step2 = ({ onNext }) => {
  const { validationToken, email, userId, setUserId, setStepComplete } = useOnboardingStore();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [done, setDone] = useState(!!userId);

  useEffect(() => {
    // Auto-submit if we already have a validationToken and no userId yet
    if (validationToken && !userId) {
      handleRegister();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegister = async () => {
    setLoading(true);
    setApiError('');
    try {
      // We need the password — stored in the validationToken (it was validated in step 1)
      // Re-read from store
      const password = useOnboardingStore.getState().password;
      const response = await registerStudent(validationToken, email, password || '');
      setAuth(
        { userId: response.userId, email: response.email, role: 'student',
          emailVerified: false, accountStatus: response.accountStatus },
        response.accessToken,
        response.refreshToken
      );
      setUserId(response.userId);
      setStepComplete('accountCreated');
      // Trigger verification email
      try {
        await sendVerificationEmail(response.userId);
      } catch { /* non-critical */ }
      setDone(true);
    } catch (err) {
      const msg = err.response?.data?.message || 'Registration failed';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  };

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
      {apiError && <div className="alert alert-error">{apiError}</div>}
      <button className="btn-primary" onClick={handleRegister} disabled={loading}>
        Create Account
      </button>
    </>
  );
};

// ─────────────────────────────────────────────
// Step 3: Verify Email
// ─────────────────────────────────────────────
const Step3 = ({ onNext }) => {
  const { userId, email, setStepComplete } = useOnboardingStore();
  const { setUser } = useAuthStore();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [apiError, setApiError] = useState('');
  const [tokenError, setTokenError] = useState('');

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!token.trim()) { setTokenError('Please enter the verification token'); return; }
    setLoading(true);
    setApiError('');
    try {
      const data = await verifyEmail(token.trim());
      setUser({ emailVerified: true, accountStatus: data.accountStatus });
      setStepComplete('emailVerified');
      onNext();
    } catch (err) {
      setApiError(err.response?.data?.message || 'Invalid or expired token');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!userId) return;
    setResending(true);
    try {
      await sendVerificationEmail(userId);
      setApiError('');
    } catch {
      setApiError('Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

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
      </form>

      <div className="step-footer">
        <span>Didn't receive it?</span>
        <button className="link-button" onClick={handleResend} disabled={resending}>
          {resending ? 'Sending...' : 'Resend email'}
        </button>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────
// Step 4: Link GitHub (optional)
// ─────────────────────────────────────────────
const Step4 = ({ onFinish }) => {
  const { setStepComplete } = useOnboardingStore();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleLinkGithub = async () => {
    setLoading(true);
    setApiError('');
    try {
      const { initiateGithubOAuth } = await import('../../api/authService');
      const data = await initiateGithubOAuth(window.location.origin + '/auth/github/oauth/callback');
      window.location.href = data.authorizationUrl;
    } catch (err) {
      setApiError(err.response?.data?.message || 'Failed to initiate GitHub OAuth');
      setLoading(false);
    }
  };

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
    canNavigateTo,
    isFullyComplete,
    reset,
  } = useOnboardingStore();
  const { user } = useAuthStore();

  // Handle email verification deep-link: /onboarding?step=verify-email&token=xxx
  useEffect(() => {
    const step = searchParams.get('step');
    const token = searchParams.get('token');
    if (step === 'verify-email' && token) {
      setCurrentStep(3);
    }
  }, [searchParams, setCurrentStep]);

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
        return <Step1 onNext={nextStep} />;
      case 2:
        return <Step2 onNext={nextStep} />;
      case 3:
        return (
          <Step3
            onNext={() => {
              nextStep();
            }}
          />
        );
      case 4:
        return <Step4 onFinish={handleCompleteAndFinish} />;
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
