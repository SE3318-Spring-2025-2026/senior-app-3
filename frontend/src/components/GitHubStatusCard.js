import React from 'react';

/**
 * GitHub Integration Status Card
 * Displays GitHub connection status, repository URL, and last sync time
 */
const GitHubStatusCard = ({ data, isLoading }) => {
  const { connected, repo_url, last_synced } = data || {};

  const formatDate = (dateString) => {
    if (!dateString) return 'Not synced';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  return (
    <div className="status-card">
      <div className="card-header">
        <h3 className="card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub Integration
        </h3>
        <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="card-content">
        {connected ? (
          <>
            <div className="info-row">
              <span className="info-label">Repository URL:</span>
              <span className="info-value">
                {repo_url ? (
                  <a href={repo_url} target="_blank" rel="noopener noreferrer">
                    {repo_url}
                  </a>
                ) : (
                  'Not configured'
                )}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Last Synced:</span>
              <span className="info-value">{formatDate(last_synced)}</span>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
            GitHub integration not configured. Set up your GitHub organization to enable this feature.
          </p>
        )}
      </div>
    </div>
  );
};

export default GitHubStatusCard;
