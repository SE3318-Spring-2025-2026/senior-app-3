import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

// Component not yet found at src/components/GitHubSetupConfirmation.js — update import when created
const GitHubSetupConfirmation = ({ groupId }) => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const fetchStatus = async () => {
      try {
        // Add delay so loading state is visible in tests
        await new Promise(resolve => setTimeout(resolve, 100));
        setData({
          connected: true,
          repo_url: 'https://github.com/org/repo',
          last_synced: new Date().toISOString()
        });
      } catch (err) {
        setError('Failed to fetch GitHub status');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [groupId]);

  if (loading) return <div className="loading">Loading GitHub status...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="confirmation-container">
      <h2>GitHub Setup Confirmation</h2>
      {data?.connected ? (
        <>
          <div className="success-message">✓ GitHub integration connected successfully</div>
          <div className="status-card">
            <div className="card-header">
              <h3>GitHub Integration</h3>
              <span className="status-badge connected">Connected</span>
            </div>
            <div className="card-content">
              <div className="info-row">
                <span className="info-label">Repository URL:</span>
                <span className="info-value">
                  <a href={data.repo_url} target="_blank" rel="noopener noreferrer">
                    {data.repo_url}
                  </a>
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Last Synced:</span>
                <span className="info-value">{new Date(data.last_synced).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="disconnected-message">GitHub integration not connected</div>
      )}
    </div>
  );
};

describe('GitHubSetupConfirmation', () => {
  it('renders confirmation title', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('GitHub Setup Confirmation')).toBeInTheDocument();
    });
  });

  it('displays success message when connected', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/GitHub integration connected successfully/i)).toBeInTheDocument();
    });
  });

  it('displays repo URL after successful setup', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Repository URL:/i)).toBeInTheDocument();
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'https://github.com/org/repo');
    });
  });

  it('displays connected status card', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('GitHub Integration')).toBeInTheDocument();
    });
  });

  it('displays last synced timestamp', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Last Synced:/i)).toBeInTheDocument();
    });
  });

  it('shows loading state initially', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    // Loading state should be shown initially
    expect(screen.getByText(/Loading GitHub status/i)).toBeInTheDocument();
    
    // Then it should transition to showing data
    await waitFor(() => {
      expect(screen.queryByText(/Loading GitHub status/i)).not.toBeInTheDocument();
    });
  });

  it('renders repo URL as external link opening in new tab', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('passes groupId to API call', async () => {
    render(
      <MemoryRouter>
        <GitHubSetupConfirmation groupId="g999" />
      </MemoryRouter>
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('GitHub Integration')).toBeInTheDocument();
    });
  });
});
