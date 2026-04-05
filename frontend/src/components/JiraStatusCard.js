import React from 'react';

/**
 * JIRA Integration Status Card
 * Displays JIRA connection status, project key, and board URL
 */
const JiraStatusCard = ({ data, isLoading }) => {
  const { connected, project_key, board_url } = data || {};

  return (
    <div className="status-card">
      <div className="card-header">
        <h3 className="card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM3 8a1 1 0 1 0 2 0 1 1 0 0 0-2 0zm4 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0zm4 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0z" />
          </svg>
          JIRA Integration
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
              <span className="info-label">Project Key:</span>
              <span className="info-value">{project_key || 'Not configured'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Board URL:</span>
              <span className="info-value">
                {board_url ? (
                  <a href={board_url} target="_blank" rel="noopener noreferrer">
                    {board_url}
                  </a>
                ) : (
                  'Not available'
                )}
              </span>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
            JIRA integration not configured. Set up your JIRA project to enable this feature.
          </p>
        )}
      </div>
    </div>
  );
};

export default JiraStatusCard;
