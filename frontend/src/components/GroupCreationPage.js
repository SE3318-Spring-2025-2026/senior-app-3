import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { createGroup, getScheduleWindow } from '../api/groupService';
import './GroupCreationPage.css';

/**
 * Group Creation Page — Process 2.1
 *
 * Student submits a group creation request. The requesting student is
 * automatically set as Team Leader. Data is forwarded to process 2.2
 * for validation (DFD flow f01 → f02).
 */
const GroupCreationPage = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [scheduleWindow, setScheduleWindow] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);

  const [formData, setFormData] = useState({
    groupName: '',
    githubPat: '',
    githubOrg: '',
    jiraUrl: '',
    jiraUsername: '',
    jiraToken: '',
    projectKey: '',
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  // Check schedule window on mount
  useEffect(() => {
    getScheduleWindow().then((data) => {
      setScheduleWindow(data);
      setScheduleLoading(false);
    });
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const errors = {};
    if (!formData.groupName.trim()) {
      errors.groupName = 'Group name is required.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const result = await createGroup({
        groupName: formData.groupName.trim(),
        leaderId: user.userId,
        githubPat: formData.githubPat.trim() || undefined,
        githubOrg: formData.githubOrg.trim() || undefined,
        jiraUrl: formData.jiraUrl.trim() || undefined,
        jiraUsername: formData.jiraUsername.trim() || undefined,
        jiraToken: formData.jiraToken.trim() || undefined,
        projectKey: formData.projectKey.trim() || undefined,
      });

      navigate(`/groups/${result.groupId}`);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'GROUP_NAME_TAKEN') {
        setFieldErrors({ groupName: 'A group with this name already exists. Please choose a different name.' });
      } else if (data?.code === 'OUTSIDE_SCHEDULE_WINDOW') {
        setSubmitError('Group creation is currently closed. Please check the coordinator-defined schedule.');
      } else if (data?.code === 'STUDENT_ALREADY_IN_GROUP' || data?.code === 'STUDENT_ALREADY_LEADER') {
        setSubmitError('You already belong to an active group and cannot create another.');
      } else {
        setSubmitError(data?.message || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isWindowClosed = !scheduleLoading && (!scheduleWindow || !scheduleWindow.open);

  return (
    <div className="group-creation-container">
      <div className="group-creation-form">
        <h2>Create a Group</h2>
        <p className="form-subtitle">
          You will automatically be assigned as Team Leader.
        </p>

        {/* Schedule window status banner */}
        {!scheduleLoading && (
          <div className={`schedule-banner ${scheduleWindow?.open ? 'open' : 'closed'}`}>
            <span className="banner-icon">{scheduleWindow?.open ? '✓' : '✕'}</span>
            <span>
              {scheduleWindow?.open
                ? scheduleWindow.window?.label
                  ? `Group creation is open: ${scheduleWindow.window.label}`
                  : 'Group creation is currently open.'
                : 'Group creation is currently closed. Contact your coordinator for the schedule.'}
            </span>
          </div>
        )}

        {submitError && (
          <div className="alert error">{submitError}</div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* ── Required ── */}
          <div className="form-section-title">Group Details</div>

          <div className="form-group">
            <label htmlFor="groupName">Group Name</label>
            <input
              id="groupName"
              name="groupName"
              type="text"
              value={formData.groupName}
              onChange={handleChange}
              placeholder="e.g. Alpha Team"
              className={fieldErrors.groupName ? 'input-error' : ''}
              disabled={loading || isWindowClosed}
              autoFocus
            />
            {fieldErrors.groupName && (
              <span className="field-error">{fieldErrors.groupName}</span>
            )}
          </div>

          {/* ── Optional: GitHub ── */}
          <div className="form-section-title">GitHub Integration <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: '0.75rem' }}>(optional)</span></div>

          <div className="form-group">
            <label htmlFor="githubOrg">
              GitHub Organisation <span className="optional">optional</span>
            </label>
            <input
              id="githubOrg"
              name="githubOrg"
              type="text"
              value={formData.githubOrg}
              onChange={handleChange}
              placeholder="e.g. my-org"
              disabled={loading || isWindowClosed}
            />
          </div>

          <div className="form-group">
            <label htmlFor="githubPat">
              GitHub Personal Access Token <span className="optional">optional</span>
            </label>
            <input
              id="githubPat"
              name="githubPat"
              type="password"
              value={formData.githubPat}
              onChange={handleChange}
              placeholder="ghp_••••••••"
              disabled={loading || isWindowClosed}
            />
          </div>

          {/* ── Optional: Jira ── */}
          <div className="form-section-title">Jira Integration <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: '0.75rem' }}>(optional)</span></div>

          <div className="form-group">
            <label htmlFor="jiraUrl">
              Jira URL <span className="optional">optional</span>
            </label>
            <input
              id="jiraUrl"
              name="jiraUrl"
              type="url"
              value={formData.jiraUrl}
              onChange={handleChange}
              placeholder="https://yourteam.atlassian.net"
              disabled={loading || isWindowClosed}
            />
          </div>

          <div className="form-group">
            <label htmlFor="jiraUsername">
              Jira Username / Email <span className="optional">optional</span>
            </label>
            <input
              id="jiraUsername"
              name="jiraUsername"
              type="text"
              value={formData.jiraUsername}
              onChange={handleChange}
              placeholder="user@example.com"
              disabled={loading || isWindowClosed}
            />
          </div>

          <div className="form-group">
            <label htmlFor="jiraToken">
              Jira API Token <span className="optional">optional</span>
            </label>
            <input
              id="jiraToken"
              name="jiraToken"
              type="password"
              value={formData.jiraToken}
              onChange={handleChange}
              placeholder="••••••••"
              disabled={loading || isWindowClosed}
            />
          </div>

          <div className="form-group">
            <label htmlFor="projectKey">
              Project Key <span className="optional">optional</span>
            </label>
            <input
              id="projectKey"
              name="projectKey"
              type="text"
              value={formData.projectKey}
              onChange={handleChange}
              placeholder="e.g. ALPHA"
              disabled={loading || isWindowClosed}
            />
          </div>

          <button
            type="submit"
            className="submit-button"
            disabled={loading || isWindowClosed}
          >
            {loading ? 'Creating group…' : 'Create Group'}
          </button>
        </form>

        <button className="back-link" onClick={() => navigate('/dashboard')}>
          ← Back to dashboard
        </button>
      </div>
    </div>
  );
};

export default GroupCreationPage;
