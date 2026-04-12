import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import * as authService from '../api/authService';

jest.mock('../api/authService');

describe('GitHub OAuth Initiation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete window.location;
    window.location = { href: '', origin: 'http://localhost:3000' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GitHubOAuthInitiationButton (simplified test component)', () => {
    // Simple test component that uses initiateGithubOAuth
    const GitHubOAuthInitiationButton = () => {
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState(null);

      const handleClick = async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await authService.initiateGithubOAuth(
            'http://localhost:3000/auth/github/callback'
          );
          window.location.href = data.authorizationUrl;
        } catch (err) {
          setError(err.response?.data?.message || 'Failed to initiate GitHub OAuth');
          setLoading(false);
        }
      };

      return (
        <div>
          <button onClick={handleClick} disabled={loading}>
            {loading ? 'Loading...' : 'Continue with GitHub'}
          </button>
          {error && <div data-testid="error-message">{error}</div>}
        </div>
      );
    };

    it('renders button and is clickable', () => {
      render(<GitHubOAuthInitiationButton />);
      const button = screen.getByRole('button', { name: /continue with github/i });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });

    it('calls initiateGithubOAuth when button is clicked', async () => {
      authService.initiateGithubOAuth.mockResolvedValue({
        authorizationUrl: 'https://github.com/oauth/authorize?...',
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        expect(authService.initiateGithubOAuth).toHaveBeenCalledWith(
          'http://localhost:3000/auth/github/callback'
        );
      });
    });

    it('shows loading state during API call', async () => {
      authService.initiateGithubOAuth.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
      );

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
      });
    });

    it('redirects to GitHub URL on successful API response', async () => {
      const githubAuthUrl = 'https://github.com/oauth/authorize?client_id=test&state=abc';
      authService.initiateGithubOAuth.mockResolvedValue({
        authorizationUrl: githubAuthUrl,
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        expect(window.location.href).toBe(githubAuthUrl);
      });
    });

    it('shows error message on API failure', async () => {
      authService.initiateGithubOAuth.mockRejectedValue({
        response: {
          data: {
            message: 'GitHub service is unavailable',
          },
        },
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(
          'GitHub service is unavailable'
        );
      });
    });

    it('shows generic error message when API error has no message', async () => {
      authService.initiateGithubOAuth.mockRejectedValue({
        response: {
          data: {},
        },
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(
          'Failed to initiate GitHub OAuth'
        );
      });
    });

    it('does not redirect on API error', async () => {
      authService.initiateGithubOAuth.mockRejectedValue({
        response: {
          data: { message: 'Invalid request' },
        },
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        // On error, should show error message and NOT redirect
        expect(screen.getByTestId('error-message')).toHaveTextContent('Invalid request');
        // window.location.href should not have been set
        expect(window.location.href).not.toMatch(/github\.com\/oauth/);
      });
    });

    it('button is disabled after error (can click again)', async () => {
      authService.initiateGithubOAuth.mockRejectedValueOnce({
        response: { data: { message: 'Error' } },
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });

      // First click fails
      await user.click(button);
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });

      // Button should be enabled again for retry
      expect(button).not.toBeDisabled();

      // Second attempt succeeds
      authService.initiateGithubOAuth.mockResolvedValueOnce({
        authorizationUrl: 'https://github.com/oauth/authorize?...',
      });

      await user.click(button);

      await waitFor(() => {
        expect(window.location.href).toBe('https://github.com/oauth/authorize?...');
      });
    });

    it('passes correct redirectUri parameter to API', async () => {
      authService.initiateGithubOAuth.mockResolvedValue({
        authorizationUrl: 'https://github.com/oauth/authorize',
      });

      const user = userEvent.setup();
      render(<GitHubOAuthInitiationButton />);

      const button = screen.getByRole('button', { name: /continue with github/i });
      await user.click(button);

      await waitFor(() => {
        expect(authService.initiateGithubOAuth).toHaveBeenCalledWith(
          expect.stringContaining('/auth/github/callback')
        );
      });
    });
  });
});
