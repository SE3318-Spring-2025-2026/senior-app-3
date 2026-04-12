import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock groupService
jest.mock('../api/groupService', () => ({
  setupGitHub: jest.fn(),
  setupJira: jest.fn(),
  getGroup: jest.fn(),
  getGitHubStatus: jest.fn(),
  getJiraStatus: jest.fn()
}));

// Mock authStore
jest.mock('../store/authStore', () => ({
  useAuthStore: jest.fn()
}));

import { setupGitHub, setupJira, getGroup, getGitHubStatus, getJiraStatus } from '../api/groupService';
import { useAuthStore } from '../store/authStore';

// Test components for integration flows
const IntegrationSetupFlow = ({ groupId }) => {
  const [step, setStep] = React.useState('github-setup'); // github-setup, github-confirm, jira-setup, jira-confirm, complete
  const [githubData, setGithubData] = React.useState(null);
  const [jiraData, setJiraData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const handleGitHubSetup = async (data) => {
    setLoading(true);
    try {
      const response = await setupGitHub(groupId, data);
      setGithubData(response.data);
      setStep('github-confirm');
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'GitHub setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleJiraSetup = async (data) => {
    setLoading(true);
    try {
      const response = await setupJira(groupId, data);
      setJiraData(response.data);
      setStep('jira-confirm');
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'JIRA setup failed');
    } finally {
      setLoading(false);
    }
  };

  const proceedToJira = () => {
    setStep('jira-setup');
  };

  const completeSetup = () => {
    setStep('complete');
  };

  return (
    <div className="integration-setup-flow">
      <h1>Integration Setup Flow</h1>

      {error && (
        <div className="error-banner" data-testid="error-banner">
          {error}
        </div>
      )}

      {step === 'github-setup' && (
        <div data-testid="github-setup-step">
          <h2>Setup GitHub</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleGitHubSetup({
                pat: 'token123',
                orgName: 'my-org',
                repoName: 'my-repo'
              });
            }}
          >
            <button type="submit" disabled={loading}>
              {loading ? 'Setting up...' : 'Setup GitHub'}
            </button>
          </form>
        </div>
      )}

      {step === 'github-confirm' && (
        <div data-testid="github-confirm-step">
          <h2>GitHub Setup Confirmed</h2>
          <p>Repository: {githubData?.repo_url || 'N/A'}</p>
          <p>Status: Connected</p>
          <button onClick={proceedToJira} className="next-button">
            Proceed to JIRA Setup
          </button>
        </div>
      )}

      {step === 'jira-setup' && (
        <div data-testid="jira-setup-step">
          <h2>Setup JIRA</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleJiraSetup({
                host_url: 'https://company.atlassian.net',
                email: 'user@company.com',
                api_token: 'jira_token',
                project_key: 'PROJ'
              });
            }}
          >
            <button type="submit" disabled={loading}>
              {loading ? 'Setting up...' : 'Setup JIRA'}
            </button>
          </form>
        </div>
      )}

      {step === 'jira-confirm' && (
        <div data-testid="jira-confirm-step">
          <h2>JIRA Setup Confirmed</h2>
          <p>Project Key: {jiraData?.project_key || 'N/A'}</p>
          <p>Status: Connected</p>
          <button onClick={completeSetup} className="complete-button">
            Complete Setup
          </button>
        </div>
      )}

      {step === 'complete' && (
        <div data-testid="setup-complete-step">
          <h2>Setup Complete</h2>
          <p>Both GitHub and JIRA are now connected</p>
          <div className="integrations-summary">
            <div className="github-summary">GitHub: Connected</div>
            <div className="jira-summary">JIRA: Connected</div>
          </div>
        </div>
      )}
    </div>
  );
};

describe('Integration E2E - GitHub/JIRA Setup Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - GitHub Setup', () => {
    it('starts with GitHub setup form', () => {
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      expect(screen.getByTestId('github-setup-step')).toBeInTheDocument();
      // Use getByRole to get the heading specifically
      expect(screen.getByRole('heading', { name: /Setup GitHub/i })).toBeInTheDocument();
    });

    it('transitions to GitHub confirmation on successful setup', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: {
          repo_url: 'https://github.com/my-org/my-repo',
          last_synced: new Date().toISOString(),
          connected: true
        }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      const setupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });
    });

    it('displays GitHub repo URL in confirmation step', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: {
          repo_url: 'https://github.com/my-org/my-repo',
          last_synced: new Date().toISOString(),
          connected: true
        }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      const setupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByText(/https:\/\/github\.com\/my-org\/my-repo/)).toBeInTheDocument();
      });
    });

    it('allows proceeding to JIRA setup from GitHub confirmation', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: {
          repo_url: 'https://github.com/my-org/my-repo',
          connected: true
        }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // Complete GitHub setup
      const gitHubSetupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(gitHubSetupButton);

      // Proceed to JIRA
      await waitFor(() => {
        expect(screen.getByText('Proceed to JIRA Setup')).toBeInTheDocument();
      });

      const proceedButton = screen.getByRole('button', { name: /Proceed to JIRA Setup/i });
      await user.click(proceedButton);

      expect(screen.getByTestId('jira-setup-step')).toBeInTheDocument();
    });
  });

  describe('Happy Path - JIRA Setup', () => {
    it('transitions to JIRA confirmation on successful setup', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: {
          repo_url: 'https://github.com/my-org/my-repo',
          connected: true
        }
      });
      setupJira.mockResolvedValue({
        data: {
          project_key: 'PROJ',
          board_url: 'https://company.atlassian.net/software/c/projects/PROJ/boards/1',
          connected: true
        }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // Complete GitHub setup
      const gitHubSetupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(gitHubSetupButton);

      // Proceed to JIRA
      await waitFor(() => {
        expect(screen.getByText('Proceed to JIRA Setup')).toBeInTheDocument();
      });
      const proceedButton = screen.getByRole('button', { name: /Proceed to JIRA Setup/i });
      await user.click(proceedButton);

      // Complete JIRA setup
      const jiraSetupButton = screen.getByRole('button', { name: /Setup JIRA/i });
      await user.click(jiraSetupButton);

      await waitFor(() => {
        expect(screen.getByTestId('jira-confirm-step')).toBeInTheDocument();
      });
    });

    it('displays JIRA project key in confirmation step', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });
      setupJira.mockResolvedValue({
        data: {
          project_key: 'MYPROJ',
          board_url: 'https://company.atlassian.net/board',
          connected: true
        }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // GitHub setup
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));
      // Proceed to JIRA
      await waitFor(() => {
        expect(screen.getByText('Proceed to JIRA Setup')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /Proceed to JIRA Setup/i }));

      // JIRA setup
      await user.click(screen.getByRole('button', { name: /Setup JIRA/i }));

      await waitFor(() => {
        expect(screen.getByText(/MYPROJ/)).toBeInTheDocument();
      });
    });
  });

  describe('Happy Path - Complete Flow', () => {
    it('allows completing entire setup workflow', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });
      setupJira.mockResolvedValue({
        data: { project_key: 'PROJ', board_url: 'https://company.atlassian.net/board', connected: true }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // GitHub setup
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));
      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });

      // Proceed to JIRA
      await user.click(screen.getByRole('button', { name: /Proceed to JIRA Setup/i }));
      expect(screen.getByTestId('jira-setup-step')).toBeInTheDocument();

      // JIRA setup
      await user.click(screen.getByRole('button', { name: /Setup JIRA/i }));
      await waitFor(() => {
        expect(screen.getByTestId('jira-confirm-step')).toBeInTheDocument();
      });

      // Complete setup
      await user.click(screen.getByRole('button', { name: /Complete Setup/i }));
      expect(screen.getByTestId('setup-complete-step')).toBeInTheDocument();
    });

    it('shows both integrations as connected in final summary', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });
      setupJira.mockResolvedValue({
        data: { project_key: 'PROJ', board_url: 'https://company.atlassian.net/board', connected: true }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // Complete GitHub
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));
      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /Proceed to JIRA Setup/i }));

      // Complete JIRA
      await user.click(screen.getByRole('button', { name: /Setup JIRA/i }));
      await waitFor(() => {
        expect(screen.getByTestId('jira-confirm-step')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /Complete Setup/i }));

      // Verify final state
      expect(screen.getByText(/GitHub: Connected/)).toBeInTheDocument();
      expect(screen.getByText(/JIRA: Connected/)).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('displays error when GitHub setup fails with invalid PAT', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockRejectedValue({
        response: { status: 422, data: { message: 'The GitHub PAT is invalid' } }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      const setupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toHaveTextContent('The GitHub PAT is invalid');
      });
    });

    it('keeps user on GitHub setup form when setup fails', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockRejectedValue({
        response: { status: 422, data: { message: 'Invalid credentials' } }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      const setupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeInTheDocument();
      });

      // Should still be on GitHub setup step
      expect(screen.getByTestId('github-setup-step')).toBeInTheDocument();
    });

    it('displays error when JIRA setup fails with invalid credentials', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });
      setupJira.mockRejectedValue({
        response: { status: 422, data: { message: 'Invalid JIRA credentials' } }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // GitHub setup
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));
      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });

      // Proceed to JIRA
      await user.click(screen.getByRole('button', { name: /Proceed to JIRA Setup/i }));

      // JIRA setup fails
      const jiraSetupButton = screen.getByRole('button', { name: /Setup JIRA/i });
      await user.click(jiraSetupButton);

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toHaveTextContent('Invalid JIRA credentials');
      });
    });

    it('keeps user on JIRA setup form when setup fails', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });
      setupJira.mockRejectedValue({
        response: { status: 422, data: { message: 'Invalid project key' } }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // GitHub setup
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));
      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });

      // Proceed to JIRA
      await user.click(screen.getByRole('button', { name: /Proceed to JIRA Setup/i }));

      // JIRA setup fails
      await user.click(screen.getByRole('button', { name: /Setup JIRA/i }));

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeInTheDocument();
      });

      // Should still be on JIRA setup step
      expect(screen.getByTestId('jira-setup-step')).toBeInTheDocument();
    });

    it('allows retrying after error', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub
        .mockRejectedValueOnce({
          response: { status: 422, data: { message: 'Invalid PAT' } }
        })
        .mockResolvedValueOnce({
          data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
        });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g1" />
        </MemoryRouter>
      );

      // First attempt - fails
      const setupButton = screen.getByRole('button', { name: /Setup GitHub/i });
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeInTheDocument();
      });

      // Second attempt - succeeds
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));

      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });
    });
  });

  describe('API Call Validation', () => {
    it('calls setupGitHub with correct groupId', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g123" />
        </MemoryRouter>
      );

      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));

      await waitFor(() => {
        expect(setupGitHub).toHaveBeenCalledWith('g123', expect.any(Object));
      });
    });

    it('calls setupJira with correct groupId', async () => {
      const user = userEvent.setup();
      useAuthStore.mockReturnValue({ user: { id: 'u1', role: 'leader' } });
      setupGitHub.mockResolvedValue({
        data: { repo_url: 'https://github.com/my-org/my-repo', connected: true }
      });
      setupJira.mockResolvedValue({
        data: { project_key: 'PROJ', board_url: 'https://company.atlassian.net/board', connected: true }
      });

      render(
        <MemoryRouter>
          <IntegrationSetupFlow groupId="g456" />
        </MemoryRouter>
      );

      // GitHub setup
      await user.click(screen.getByRole('button', { name: /Setup GitHub/i }));
      await waitFor(() => {
        expect(screen.getByTestId('github-confirm-step')).toBeInTheDocument();
      });

      // Proceed to JIRA
      await user.click(screen.getByRole('button', { name: /Proceed to JIRA Setup/i }));

      // JIRA setup
      await user.click(screen.getByRole('button', { name: /Setup JIRA/i }));

      await waitFor(() => {
        expect(setupJira).toHaveBeenCalledWith('g456', expect.any(Object));
      });
    });
  });
});
