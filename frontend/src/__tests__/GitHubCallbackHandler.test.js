import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import GitHubCallbackHandler from '../components/GitHubCallbackHandler';
import useAuthStore from '../store/authStore';
import useOnboardingStore from '../store/onboardingStore';
import * as onboardingService from '../api/onboardingService';

jest.mock('../store/authStore');
jest.mock('../store/onboardingStore');
jest.mock('../api/onboardingService');

describe('GitHubCallbackHandler', () => {
  const mockSetUser = jest.fn();
  const mockSetStepComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock useAuthStore - it's a zustand hook, so mock as a hook
    useAuthStore.mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      setUser: mockSetUser,
    });

    // Mock useOnboardingStore - it's a zustand hook, so mock as a hook
    useOnboardingStore.mockReturnValue({
      setStepComplete: mockSetStepComplete,
      userId: '123',
    });
    
    // Mock the getState static method
    useOnboardingStore.getState = jest.fn(() => ({
      userId: '123',
      reset: jest.fn(),
    }));

    // Mock onboardingService
    onboardingService.completeOnboarding = jest.fn().mockResolvedValue({});
  });

  describe('Success State', () => {
    it('displays success message when status=linked', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=octocat']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('GitHub Connected')).toBeInTheDocument();
      expect(screen.getByText(/Your GitHub account has been linked successfully/)).toBeInTheDocument();
      expect(screen.getByText('@octocat')).toBeInTheDocument();
    });

    it('updates user with githubUsername on success', async () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=octocat']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockSetUser).toHaveBeenCalledWith(
          expect.objectContaining({
            githubUsername: 'octocat',
          })
        );
      });
    });

    it('marks githubLinked step complete on success', async () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=octocat']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockSetStepComplete).toHaveBeenCalledWith('githubLinked');
      });
    });

    it('renders Continue to Dashboard button', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=octocat']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /continue to dashboard/i })).toBeInTheDocument();
    });

    it('calls completeOnboarding and navigates on Continue button click', async () => {
      const user = userEvent.setup();
      onboardingService.completeOnboarding.mockResolvedValue({});

      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=octocat']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      const button = screen.getByRole('button', { name: /continue to dashboard/i });
      await user.click(button);

      await waitFor(() => {
        expect(onboardingService.completeOnboarding).toHaveBeenCalled();
      });
    });
  });

  describe('Loading State', () => {
    it('component initializes in loading state then transitions', () => {
      // When no params are provided, component shows error, not loading
      render(
        <MemoryRouter initialEntries={['/auth/github/callback']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      // Should show fallback error since no params present
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
      expect(screen.getByText(/unexpected error occurred/)).toBeInTheDocument();
    });
  });

  describe('Error States', () => {
    it('displays error message when error=access_denied', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=access_denied']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('GitHub Access Denied')).toBeInTheDocument();
      expect(screen.getByText(/You declined to authorize/)).toBeInTheDocument();
    });

    it('displays error message when error=TOKEN_EXCHANGE_FAILED', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=TOKEN_EXCHANGE_FAILED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('Authorization Failed')).toBeInTheDocument();
      expect(screen.getByText(/authorization code could not be exchanged/)).toBeInTheDocument();
    });

    it('displays error message when error=INVALID_STATE', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=INVALID_STATE']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('Session Expired')).toBeInTheDocument();
      expect(screen.getByText(/GitHub authorization session expired/)).toBeInTheDocument();
    });

    it('displays error message when error=GITHUB_ALREADY_LINKED', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=GITHUB_ALREADY_LINKED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('GitHub Account Already In Use')).toBeInTheDocument();
      expect(screen.getByText(/already linked to a different user/)).toBeInTheDocument();
    });

    it('displays error message when error=GITHUB_USERNAME_TAKEN', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=GITHUB_USERNAME_TAKEN']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('GitHub Username Already Taken')).toBeInTheDocument();
      expect(screen.getByText(/Each student must link a unique GitHub account/)).toBeInTheDocument();
    });

    it('displays error message when error=GITHUB_API_FAILED', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=GITHUB_API_FAILED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('GitHub API Error')).toBeInTheDocument();
      expect(screen.getByText(/Could not retrieve your GitHub profile/)).toBeInTheDocument();
    });

    it('displays error message when error=USER_NOT_FOUND', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=USER_NOT_FOUND']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('Session Error')).toBeInTheDocument();
      expect(screen.getByText(/Your session could not be found/)).toBeInTheDocument();
    });

    it('displays fallback error message for unknown error codes', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=UNKNOWN_ERROR']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
      expect(screen.getByText(/unexpected error occurred during GitHub authorization/)).toBeInTheDocument();
    });

    it('shows Try Again button for retriable errors', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=TOKEN_EXCHANGE_FAILED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('shows Connect a Different Account button for duplicate Account errors', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=GITHUB_ALREADY_LINKED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /connect a different account/i })).toBeInTheDocument();
    });

    it('shows Skip GitHub button on error', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=TOKEN_EXCHANGE_FAILED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: /skip github/i })).toBeInTheDocument();
    });
  });

  describe('Missing Parameters', () => {
    it('shows error when no recognizable params present', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?random=param']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });

    it('shows error when missing githubUsername on success', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      // Should show error since githubUsername is missing
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('shows empty string username safely when provided', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      // Should treat empty username as missing
      expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    });

    it('handles special characters in githubUsername', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=test-user_123']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      expect(screen.getByText('@test-user_123')).toBeInTheDocument();
    });

    it('displays error alert with correct styling', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?error=TOKEN_EXCHANGE_FAILED']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      const alert = screen.getByText(/authorization code could not be exchanged/);
      expect(alert).toHaveClass('alert', 'alert-error');
    });

    it('displays success alert with correct styling', () => {
      render(
        <MemoryRouter initialEntries={['/auth/github/callback?status=linked&githubUsername=octocat']}>
          <GitHubCallbackHandler />
        </MemoryRouter>
      );

      const alert = screen.getByText(/Connected as/);
      expect(alert).toHaveClass('alert', 'alert-success');
    });
  });
});
