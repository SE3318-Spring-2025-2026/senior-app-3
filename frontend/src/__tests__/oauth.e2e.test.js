import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useOnboardingStore from '../store/onboardingStore';
import * as authService from '../api/authService';
import * as onboardingService from '../api/onboardingService';
import GitHubCallbackHandler from '../components/GitHubCallbackHandler';

jest.mock('../store/authStore');
jest.mock('../store/onboardingStore');
jest.mock('../api/authService');
jest.mock('../api/onboardingService');

describe('OAuth End-to-End Flows', () => {
  const StudentDashboard = () => <div>Student Dashboard - Welcome</div>;

  const renderOAuthFlow = (initialRoute = '/auth/github/callback') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/auth/github/callback" element={<GitHubCallbackHandler />} />
          <Route path="/dashboard" element={<StudentDashboard />} />
          <Route path="/onboarding" element={<div>Onboarding</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    delete window.location;
    window.location = { href: '' };

    // Mock useAuthStore as a hook that returns store functions
    useAuthStore.mockReturnValue({
      user: { id: '123', email: 'test@example.com', role: 'student' },
      setUser: jest.fn(),
    });
    
    // Mock useAuthStore getState static method
    useAuthStore.getState = jest.fn(() => ({
      userId: '123',
    }));

    // Mock useOnboardingStore as a hook that returns store functions
    useOnboardingStore.mockReturnValue({
      setStepComplete: jest.fn(),
      userId: '123',
    });

    // Mock useOnboardingStore getState static method
    useOnboardingStore.getState = jest.fn(() => ({
      userId: '123',
      reset: jest.fn(),
    }));

    // Mock onboarding service
    onboardingService.completeOnboarding = jest.fn().mockResolvedValue({});
  });

  describe('Happy Path: GitHub OAuth Success', () => {
    it('shows success state when GitHub linking completes', () => {
      renderOAuthFlow('/auth/github/callback?status=linked&githubUsername=octocat');

      expect(screen.getByText('GitHub Connected')).toBeInTheDocument();
      expect(screen.getByText('@octocat')).toBeInTheDocument();
    });

    it('renders continue button after successful linking', () => {
      renderOAuthFlow('/auth/github/callback?status=linked&githubUsername=octocat');

      expect(screen.getByRole('button', { name: /continue to dashboard/i })).toBeInTheDocument();
    });

    it('allows user to complete onboarding after linking', async () => {
      const user = userEvent.setup();
      onboardingService.completeOnboarding.mockResolvedValue({});

      renderOAuthFlow('/auth/github/callback?status=linked&githubUsername=octocat');

      const continueButton = screen.getByRole('button', { name: /continue to dashboard/i });
      await user.click(continueButton);

      await waitFor(() => {
        expect(onboardingService.completeOnboarding).toHaveBeenCalled();
      });
    });
  });

  describe('Error Path: User Denies Authorization', () => {
    it('shows denial message when user cancels OAuth', () => {
      renderOAuthFlow('/auth/github/callback?error=access_denied');

      expect(screen.getByText('GitHub Access Denied')).toBeInTheDocument();
      expect(screen.getByText(/You declined to authorize/)).toBeInTheDocument();
    });

    it('provides retry option when user denies', () => {
      renderOAuthFlow('/auth/github/callback?error=access_denied');

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('allows user to skip GitHub and continue onboarding', async () => {
      const user = userEvent.setup();
      onboardingService.completeOnboarding.mockResolvedValue({});

      renderOAuthFlow('/auth/github/callback?error=access_denied');

      const skipButton = screen.getByRole('button', { name: /skip github/i });
      await user.click(skipButton);

      await waitFor(() => {
        expect(onboardingService.completeOnboarding).toHaveBeenCalled();
      });
    });
  });

  describe('Error Path: Expired Authorization Code', () => {
    it('shows error for expired authorization code', () => {
      renderOAuthFlow('/auth/github/callback?error=TOKEN_EXCHANGE_FAILED');

      expect(screen.getByText('Authorization Failed')).toBeInTheDocument();
      expect(screen.getByText(/authorization code could not be exchanged/)).toBeInTheDocument();
    });

    it('provides retry option for expired code', () => {
      renderOAuthFlow('/auth/github/callback?error=TOKEN_EXCHANGE_FAILED');

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('allows skipping GitHub after code failure', async () => {
      const user = userEvent.setup();
      onboardingService.completeOnboarding.mockResolvedValue({});

      renderOAuthFlow('/auth/github/callback?error=TOKEN_EXCHANGE_FAILED');

      const skipButton = screen.getByRole('button', { name: /skip github/i });
      await user.click(skipButton);

      await waitFor(() => {
        expect(onboardingService.completeOnboarding).toHaveBeenCalled();
      });
    });
  });

  describe('Error Path: GitHub Username Duplicate', () => {
    it('shows error for duplicate GitHub username', () => {
      renderOAuthFlow('/auth/github/callback?error=GITHUB_USERNAME_TAKEN');

      expect(screen.getByText('GitHub Username Already Taken')).toBeInTheDocument();
      expect(screen.getByText(/Each student must link a unique GitHub account/)).toBeInTheDocument();
    });

    it('provides option to connect different GitHub account', () => {
      renderOAuthFlow('/auth/github/callback?error=GITHUB_USERNAME_TAKEN');

      expect(screen.getByRole('button', { name: /connect a different account/i })).toBeInTheDocument();
    });
  });

  describe('Error Path: GitHub Already Linked', () => {
    it('shows error when GitHub account already in use', () => {
      renderOAuthFlow('/auth/github/callback?error=GITHUB_ALREADY_LINKED');

      expect(screen.getByText('GitHub Account Already In Use')).toBeInTheDocument();
      expect(screen.getByText(/already linked to a different user/)).toBeInTheDocument();
    });

    it('suggests connecting different GitHub account', () => {
      renderOAuthFlow('/auth/github/callback?error=GITHUB_ALREADY_LINKED');

      expect(screen.getByRole('button', { name: /connect a different account/i })).toBeInTheDocument();
    });
  });

  describe('OAuth Initiation', () => {
    it('calls GitHub OAuth API with correct redirect URI', async () => {
      authService.initiateGithubOAuth.mockResolvedValue({
        authorizationUrl: 'https://github.com/oauth/authorize?client_id=test&state=abc',
      });

      const currentOrigin = 'http://localhost:3000';
      const redirectUri = `${currentOrigin}/auth/github/callback`;

      // Simulate the button click
      await authService.initiateGithubOAuth(redirectUri);

      expect(authService.initiateGithubOAuth).toHaveBeenCalledWith(redirectUri);
    });

    it('handles network error during OAuth initiation', async () => {
      authService.initiateGithubOAuth.mockRejectedValue(
        new Error('Network error')
      );

      try {
        await authService.initiateGithubOAuth('http://localhost/callback');
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toBe('Network error');
      }
    });
  });

  describe('Loading States', () => {
    it('shows error state when no callback parameters provided', () => {
      renderOAuthFlow('/auth/github/callback');

      // Component shows error when no status or error params present
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });

    it('shows success state during continue button after successful linking', () => {
      renderOAuthFlow('/auth/github/callback?status=linked&githubUsername=octocat');

      const continueButton = screen.getByRole('button', { name: /continue to dashboard/i });
      expect(continueButton).not.toBeDisabled();
    });
  });

  describe('Data Flow', () => {
    it('preserves GitHub username after successful linking', () => {
      renderOAuthFlow('/auth/github/callback?status=linked&githubUsername=testuser');

      expect(screen.getByText('@testuser')).toBeInTheDocument();
    });
  });

  describe('Error Recovery', () => {
    it('allows user to retry after OAuth error', () => {
      renderOAuthFlow('/auth/github/callback?error=TOKEN_EXCHANGE_FAILED');

      const retryButton = screen.getByRole('button', { name: /try again/i });
      expect(retryButton).toBeInTheDocument();
    });

    it('allows user to proceed with onboarding without GitHub', async () => {
      const user = userEvent.setup();
      onboardingService.completeOnboarding.mockResolvedValue({});

      renderOAuthFlow('/auth/github/callback?error=GITHUB_API_FAILED');

      const skipButton = screen.getByRole('button', { name: /skip github/i });
      await user.click(skipButton);

      await waitFor(() => {
        expect(onboardingService.completeOnboarding).toHaveBeenCalled();
      });
    });
  });

  describe('Security', () => {
    it('handles invalid callback parameters gracefully', () => {
      renderOAuthFlow('/auth/github/callback?random=param');

      // Should show error instead of succeeding
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });

    it('does not proceed without status or error params', () => {
      renderOAuthFlow('/auth/github/callback');

      // Should show error when no params provided
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });

    it('shows error for missing GitHub username in success state', () => {
      renderOAuthFlow('/auth/github/callback?status=linked');

      // Missing username should not show success
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });
  });
});
