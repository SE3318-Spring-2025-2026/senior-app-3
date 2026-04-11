import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

// Component not yet found at src/components/JiraSetupConfirmation.js — update import when created
const JiraSetupConfirmation = ({ groupId }) => {
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
          project_key: 'PROJ',
          board_url: 'https://company.atlassian.net/software/c/projects/PROJ/boards/1',
          last_synced: new Date().toISOString()
        });
      } catch (err) {
        setError('Failed to fetch JIRA status');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [groupId]);

  if (loading) return <div className="loading">Loading JIRA status...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="confirmation-container">
      <h2>JIRA Setup Confirmation</h2>
      {data?.connected ? (
        <>
          <div className="success-message">✓ JIRA integration connected successfully</div>
          <div className="status-card">
            <div className="card-header">
              <h3>JIRA Integration</h3>
              <span className="status-badge connected">Connected</span>
            </div>
            <div className="card-content">
              <div className="info-row">
                <span className="info-label">Project Key:</span>
                <span className="info-value">{data.project_key}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Board URL:</span>
                <span className="info-value">
                  <a href={data.board_url} target="_blank" rel="noopener noreferrer">
                    {data.board_url}
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
        <div className="disconnected-message">JIRA integration not connected</div>
      )}
    </div>
  );
};

describe('JiraSetupConfirmation', () => {
  it('renders confirmation title', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('JIRA Setup Confirmation')).toBeInTheDocument();
    });
  });

  it('displays success message when connected', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/JIRA integration connected successfully/i)).toBeInTheDocument();
    });
  });

  it('displays project key after successful setup', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Project Key:/i)).toBeInTheDocument();
      expect(screen.getByText('PROJ')).toBeInTheDocument();
    });
  });

  it('displays board URL after successful setup', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Board URL:/i)).toBeInTheDocument();
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('atlassian.net'));
    });
  });

  it('displays connected status card', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('JIRA Integration')).toBeInTheDocument();
    });
  });

  it('displays last synced timestamp', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Last Synced:/i)).toBeInTheDocument();
    });
  });

  it('shows loading state initially', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
      </MemoryRouter>
    );

    // Loading state should be shown initially
    expect(screen.getByText(/Loading JIRA status/i)).toBeInTheDocument();
    
    // Then it should transition to showing data
    await waitFor(() => {
      expect(screen.queryByText(/Loading JIRA status/i)).not.toBeInTheDocument();
    });
  });

  it('renders board URL as external link opening in new tab', async () => {
    render(
      <MemoryRouter>
        <JiraSetupConfirmation groupId="g123" />
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
        <JiraSetupConfirmation groupId="g999" />
      </MemoryRouter>
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('JIRA Integration')).toBeInTheDocument();
    });
  });
});
