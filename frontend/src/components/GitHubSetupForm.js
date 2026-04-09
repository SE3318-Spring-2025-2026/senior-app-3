import React, { useState } from 'react';
import { configureGitHub } from '../api/groupService';
import './GitHubSetupForm.css';

/**
 * GitHub Integration Setup Form Component
 * Allows the group leader to submit GitHub PAT, organization, repository, and visibility settings
 * 
 * Process 2.6: Setup GitHub Integration
 * DFD flows: f10 (Team Leader → 2.6), f11 (2.6 → GitHub API), f12 (GitHub API → 2.6)
 */
const GitHubSetupForm = ({ groupId, onSuccess, onError, isLeader }) => {
  const [formData, setFormData] = useState({
    pat: '',
    org_name: '',
    repo_name: '',
    visibility: 'private',
  });
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [patVisible, setPatVisible] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error message when user starts typing
    if (errorMsg) {
      setErrorMsg('');
    }
  };

  const validateForm = () => {
    const errors = [];
    
    if (!formData.pat.trim()) {
      errors.push('Personal Access Token is required');
    }
    if (!formData.org_name.trim()) {
      errors.push('Organization name is required');
    }
    if (!formData.repo_name.trim()) {
      errors.push('Repository name is required');
    }
    if (!['private', 'public', 'internal'].includes(formData.visibility)) {
      errors.push('Invalid visibility setting');
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    const errors = validateForm();
    if (errors.length > 0) {
      setErrorMsg(errors.join(', '));
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const response = await configureGitHub(groupId, formData);
      
      setSuccessMsg('GitHub integration configured successfully!');
      
      // Reset form
      setFormData({
        pat: '',
        org_name: '',
        repo_name: '',
        visibility: 'private',
      });
      setShowForm(false);

      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess(response);
      }

      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        setSuccessMsg('');
      }, 5000);
    } catch (error) {
      const errorCode = error.response?.data?.code;
      const errorMessage = error.response?.data?.message || 'Failed to configure GitHub';
      
      let userFriendlyError = errorMessage;

      // Handle specific error codes
      if (errorCode === 'INVALID_PAT') {
        userFriendlyError = 'The GitHub PAT is invalid or has insufficient permissions. Please check your token.';
      } else if (errorCode === 'ORG_NOT_FOUND') {
        userFriendlyError = 'The GitHub organization was not found or your token lacks access to it.';
      } else if (errorCode === 'GITHUB_API_UNAVAILABLE') {
        userFriendlyError = 'GitHub API is currently unavailable. Please try again later.';
      } else if (errorCode === 'MISSING_PAT') {
        userFriendlyError = 'Personal Access Token is required.';
      } else if (errorCode === 'MISSING_ORG') {
        userFriendlyError = 'Organization name is required.';
      } else if (errorCode === 'MISSING_REPO') {
        userFriendlyError = 'Repository name is required.';
      } else if (error.response?.status === 403) {
        userFriendlyError = 'You do not have permission to configure GitHub for this group. Only the group leader can do this.';
      } else if (error.response?.status === 404) {
        userFriendlyError = 'Group not found.';
      }

      setErrorMsg(userFriendlyError);

      // Call onError callback if provided
      if (onError) {
        onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isLeader) {
    return (
      <div className="github-setup-form-notice">
        <p>Only the group leader can configure GitHub integration.</p>
      </div>
    );
  }

  return (
    <div className="github-setup-form-container">
      {successMsg && (
        <div className="alert alert-success">
          <svg className="alert-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 11-1.06-1.06l7.25-7.25a.75.75 0 011.06 0z" />
            <path d="M2.22 8.78l2.5-2.5a.75.75 0 011.06 1.06l-2.5 2.5a.75.75 0 11-1.06-1.06z" />
          </svg>
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-error">
          <svg className="alert-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
          </svg>
          {errorMsg}
        </div>
      )}

      {!showForm ? (
        <button
          className="btn btn-primary github-setup-toggle"
          onClick={() => setShowForm(true)}
          disabled={loading}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Setup GitHub Integration
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="github-setup-form">
          <div className="form-header">
            <h3>GitHub Integration Setup</h3>
            <button
              type="button"
              className="btn-close"
              onClick={() => setShowForm(false)}
              disabled={loading}
              aria-label="Close form"
            >
              ✕
            </button>
          </div>

          <div className="form-group">
            <label htmlFor="pat" className="form-label">
              Personal Access Token <span className="required">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type={patVisible ? 'text' : 'password'}
                id="pat"
                name="pat"
                value={formData.pat}
                onChange={handleInputChange}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="form-input"
                disabled={loading}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setPatVisible(!patVisible)}
                disabled={loading}
                aria-label={patVisible ? 'Hide PAT' : 'Show PAT'}
              >
                {patVisible ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            <small className="form-help">
              Your GitHub Personal Access Token. It will be securely stored and used for API calls.
              <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">
                Create a token
              </a>
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="org_name" className="form-label">
              Organization Name <span className="required">*</span>
            </label>
            <input
              type="text"
              id="org_name"
              name="org_name"
              value={formData.org_name}
              onChange={handleInputChange}
              placeholder="e.g., my-organization"
              className="form-input"
              disabled={loading}
              autoComplete="off"
            />
            <small className="form-help">
              The GitHub organization where the repository will be created.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="repo_name" className="form-label">
              Repository Name <span className="required">*</span>
            </label>
            <input
              type="text"
              id="repo_name"
              name="repo_name"
              value={formData.repo_name}
              onChange={handleInputChange}
              placeholder="e.g., senior-project"
              className="form-input"
              disabled={loading}
              autoComplete="off"
            />
            <small className="form-help">
              The name of the repository to create or use for this project.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="visibility" className="form-label">
              Repository Visibility <span className="required">*</span>
            </label>
            <select
              id="visibility"
              name="visibility"
              value={formData.visibility}
              onChange={handleInputChange}
              className="form-select"
              disabled={loading}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
            </select>
            <small className="form-help">
              Determine who can access your repository. Default is private for security.
            </small>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading-spinner">⌛</span>
                  Validating...
                </>
              ) : (
                'Configure GitHub'
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowForm(false)}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default GitHubSetupForm;
