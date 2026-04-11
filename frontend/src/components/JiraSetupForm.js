import React, { useState } from 'react';
import { configureJira } from '../api/groupService';
import './JiraSetupForm.css';

/**
 * JIRA Integration Setup Form Component
 * Allows the group leader to submit JIRA host, credentials, and project key.
 *
 * Process 2.7: Setup JIRA Integration
 * DFD flows: f13 (Team Leader → 2.7), f14 (2.7 → JIRA API), f15 (JIRA API → 2.7)
 * JIRA usage is strictly scoped to story point retrieval only.
 */
const JiraSetupForm = ({ groupId, onSuccess, onError, isLeader }) => {
  const [formData, setFormData] = useState({
    host: '',
    email: '',
    api_token: '',
    project_key: '',
  });
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errorMsg) setErrorMsg('');
  };

  const validateForm = () => {
    const errors = [];
    if (!formData.host.trim()) errors.push('JIRA host URL is required');
    if (!formData.email.trim()) errors.push('Email is required');
    if (!formData.api_token.trim()) errors.push('API token is required');
    if (!formData.project_key.trim()) errors.push('Project key is required');
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const errors = validateForm();
    if (errors.length > 0) {
      setErrorMsg(errors.join(', '));
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const response = await configureJira(groupId, formData);

      setSuccessMsg(
        `JIRA project bound successfully. Project: ${response.project_key} (ID: ${response.project_id})`
      );
      setFormData({ host: '', email: '', api_token: '', project_key: '' });
      setShowForm(false);

      if (onSuccess) onSuccess(response);

      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (error) {
      const errorCode = error.response?.data?.code;
      const errorMessage = error.response?.data?.message || 'Failed to configure JIRA';

      let userFriendlyError = errorMessage;

      if (errorCode === 'INVALID_JIRA_CREDENTIALS') {
        userFriendlyError = 'JIRA credentials are invalid or have insufficient permissions. Please check your email and API token.';
      } else if (errorCode === 'INVALID_PROJECT_KEY') {
        userFriendlyError = 'The JIRA project key was not found. Please verify it exists and your token has access.';
      } else if (errorCode === 'JIRA_API_UNAVAILABLE') {
        userFriendlyError = 'JIRA API is currently unavailable. Please try again later.';
      } else if (errorCode === 'MISSING_HOST') {
        userFriendlyError = 'JIRA host URL is required.';
      } else if (errorCode === 'MISSING_EMAIL') {
        userFriendlyError = 'Email is required.';
      } else if (errorCode === 'MISSING_API_TOKEN') {
        userFriendlyError = 'API token is required.';
      } else if (errorCode === 'MISSING_PROJECT_KEY') {
        userFriendlyError = 'Project key is required.';
      } else if (error.response?.status === 403) {
        userFriendlyError = 'You do not have permission to configure JIRA for this group. Only the group leader can do this.';
      } else if (error.response?.status === 404) {
        userFriendlyError = 'Group not found.';
      }

      setErrorMsg(userFriendlyError);
      if (onError) onError(error);
    } finally {
      setLoading(false);
    }
  };

  if (!isLeader) {
    return (
      <div className="jira-setup-form-notice">
        <p>Only the group leader can configure JIRA integration.</p>
      </div>
    );
  }

  return (
    <div className="jira-setup-form-container">
      {successMsg && (
        <div className="alert alert-success">
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="alert alert-error">
          {errorMsg}
        </div>
      )}

      {!showForm ? (
        <button
          className="btn btn-primary jira-setup-toggle"
          onClick={() => setShowForm(true)}
          disabled={loading}
        >
          Setup JIRA Integration
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="jira-setup-form">
          <div className="form-header">
            <h3>JIRA Integration Setup</h3>
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

          <p className="form-notice">
            JIRA integration is strictly scoped to <strong>story point retrieval</strong> only.
          </p>

          <div className="form-group">
            <label htmlFor="jira-host" className="form-label">
              JIRA Host URL <span className="required">*</span>
            </label>
            <input
              type="url"
              id="jira-host"
              name="host"
              value={formData.host}
              onChange={handleInputChange}
              placeholder="https://yourteam.atlassian.net"
              className="form-input"
              disabled={loading}
              autoComplete="off"
            />
            <small className="form-help">
              The base URL of your JIRA instance (e.g. https://yourteam.atlassian.net).
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="jira-email" className="form-label">
              Email <span className="required">*</span>
            </label>
            <input
              type="email"
              id="jira-email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="you@example.com"
              className="form-input"
              disabled={loading}
              autoComplete="off"
            />
            <small className="form-help">
              The email address associated with your JIRA account.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="jira-api-token" className="form-label">
              API Token <span className="required">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type={tokenVisible ? 'text' : 'password'}
                id="jira-api-token"
                name="api_token"
                value={formData.api_token}
                onChange={handleInputChange}
                placeholder="••••••••••••••••"
                className="form-input"
                disabled={loading}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setTokenVisible(!tokenVisible)}
                disabled={loading}
                aria-label={tokenVisible ? 'Hide token' : 'Show token'}
              >
                {tokenVisible ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            <small className="form-help">
              Generate an API token from your Atlassian account settings.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="jira-project-key" className="form-label">
              Project Key <span className="required">*</span>
            </label>
            <input
              type="text"
              id="jira-project-key"
              name="project_key"
              value={formData.project_key}
              onChange={handleInputChange}
              placeholder="e.g. ALPHA"
              className="form-input"
              disabled={loading}
              autoComplete="off"
            />
            <small className="form-help">
              The key of your JIRA project (visible in your project URL).
            </small>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="loading-spinner">⌛</span>
                  Validating...
                </>
              ) : (
                'Configure JIRA'
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

export default JiraSetupForm;
