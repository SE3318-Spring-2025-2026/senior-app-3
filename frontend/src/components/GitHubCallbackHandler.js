import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useOnboardingStore from '../store/onboardingStore';
import { completeOnboarding } from '../api/onboardingService';
import './onboarding/OnboardingStepper.css';

/**
 * Error codes sent by the backend as ?error=<code>
 * Maps each code to a user-facing message.
 */
const ERROR_MESSAGES = {
  access_denied: {
    title: 'GitHub Access Denied',
    message: 'You declined to authorize the GitHub connection. You can try again or skip this step.',
  },
  TOKEN_EXCHANGE_FAILED: {
    title: 'Authorization Failed',
    message: 'The authorization code could not be exchanged with GitHub. This can happen if the link expired. Please try again.',
  },
  INVALID_STATE: {
    title: 'Session Expired',
    message: 'Your GitHub authorization session expired (10-minute limit). Please initiate the flow again.',
  },
  GITHUB_ALREADY_LINKED: {
    title: 'GitHub Account Already In Use',
    message: 'This GitHub account is already linked to a different user. Please connect a different GitHub account.',
  },
  GITHUB_USERNAME_TAKEN: {
    title: 'GitHub Username Already Taken',
    message: 'This GitHub username is already registered by another student. Each student must link a unique GitHub account.',
  },
  GITHUB_API_FAILED: {
    title: 'GitHub API Error',
    message: 'Could not retrieve your GitHub profile. GitHub may be temporarily unavailable. Please try again.',
  },
  USER_NOT_FOUND: {
    title: 'Session Error',
    message: 'Your session could not be found. Please log in again and retry.',
  },
  MISSING_PARAMS: {
    title: 'Invalid Callback',
    message: 'The OAuth callback was missing required parameters. Please try again.',
  },
  SERVER_ERROR: {
    title: 'Server Error',
    message: 'An unexpected server error occurred. Please try again in a moment.',
  },
};

const FALLBACK_ERROR = {
  title: 'Something Went Wrong',
  message: 'An unexpected error occurred during GitHub authorization. Please try again.',
};

const GitHubCallbackHandler = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, setUser } = useAuthStore();
  const { setStepComplete } = useOnboardingStore();

  const [phase, setPhase] = useState('loading'); // 'loading' | 'success' | 'error'
  const [githubUsername, setGithubUsername] = useState('');
  const [errorInfo, setErrorInfo] = useState(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    const status = searchParams.get('status');
    const username = searchParams.get('githubUsername');
    const errorCode = searchParams.get('error');

    if (status === 'linked' && username) {
      setGithubUsername(username);
      // Merge githubUsername into the persisted user object
      if (user) {
        setUser({ ...user, githubUsername: username });
      }
      setStepComplete('githubLinked');
      setPhase('success');
    } else if (errorCode) {
      setErrorInfo(ERROR_MESSAGES[errorCode] || FALLBACK_ERROR);
      setPhase('error');
    } else {
      // No recognisable params — treat as a generic error
      setErrorInfo(FALLBACK_ERROR);
      setPhase('error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finishOnboarding = async () => {
    setFinishing(true);
    try {
      const { userId } = useOnboardingStore.getState();
      if (userId) await completeOnboarding(userId);
    } catch {
      // Non-critical — proceed anyway
    }
    useOnboardingStore.getState().reset();
    navigate('/dashboard', { replace: true });
  };

  const handleRetry = () => {
    // Navigate back to step 4 of onboarding (GitHub step)
    // The store already has steps 1-3 complete so the wizard will land on step 4
    navigate('/onboarding', { replace: true });
  };

  // ── Loading ──────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card">
          <div className="step-content">
            <h2>Connecting GitHub</h2>
            <p className="step-subtitle">Please wait while we complete the authorization...</p>
            <div className="alert alert-info">Processing GitHub response...</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card">
          <div className="step-content">
            <div className="complete-icon">&#10003;</div>
            <h2>GitHub Connected</h2>
            <p className="step-subtitle">
              Your GitHub account has been linked successfully.
            </p>
            <div className="alert alert-success">
              Connected as <strong>@{githubUsername}</strong>
            </div>
            <button
              className="btn-primary"
              onClick={finishOnboarding}
              disabled={finishing}
            >
              {finishing ? 'Finishing...' : 'Continue to Dashboard'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────
  const isDuplicate =
    errorInfo === ERROR_MESSAGES.GITHUB_ALREADY_LINKED ||
    errorInfo === ERROR_MESSAGES.GITHUB_USERNAME_TAKEN;

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        <div className="step-content">
          <h2>{errorInfo.title}</h2>
          <p className="step-subtitle">GitHub connection could not be completed.</p>
          <div className="alert alert-error">{errorInfo.message}</div>

          {!isDuplicate && (
            <button className="btn-github-link" onClick={handleRetry}>
              Try Again
            </button>
          )}

          {isDuplicate && (
            <button className="btn-github-link" onClick={handleRetry}>
              Connect a Different Account
            </button>
          )}

          <button
            className="btn-secondary"
            onClick={finishOnboarding}
            disabled={finishing}
          >
            {finishing ? 'Please wait...' : 'Skip GitHub and Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GitHubCallbackHandler;
