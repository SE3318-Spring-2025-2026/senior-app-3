import React, { useEffect, useState } from 'react';
import { getMySprintProgress, isReadOnlySprintProgress } from '../api/sprintContributionService';
import './SprintProgressCard.css';

const formatDateTime = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const getErrorMessage = (error) => {
  const status = error?.response?.status;
  if (status === 403 || error?.code === 'FORBIDDEN') {
    return {
      title: 'Access restricted',
      message: 'You can only view your own sprint progress for groups you belong to.',
    };
  }
  if (status === 404) {
    return {
      title: 'Progress not available',
      message: 'No computed sprint progress was found for this group and sprint yet.',
    };
  }
  return {
    title: 'Could not load sprint progress',
    message: 'Please refresh the page or try again later.',
  };
};

const MetricTile = ({ label, value }) => (
  <div className="sprint-progress-metric">
    <span className="sprint-progress-label">{label}</span>
    <strong className="sprint-progress-value">{value ?? 'Not available'}</strong>
  </div>
);

const SprintProgressCard = ({ groupId, sprintId }) => {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState(null);

  useEffect(() => {
    let active = true;

    const loadProgress = async () => {
      if (!groupId || !sprintId) {
        setProgress(null);
        setErrorState({
          title: 'Missing sprint context',
          message: 'A group and sprint are required to show progress.',
        });
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorState(null);

      try {
        const data = await getMySprintProgress(groupId, sprintId);
        if (active) setProgress(data);
      } catch (error) {
        if (active) {
          setProgress(null);
          setErrorState(getErrorMessage(error));
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProgress();

    return () => {
      active = false;
    };
  }, [groupId, sprintId]);

  if (loading) {
    return (
      <section className="sprint-progress-card" aria-busy="true">
        <div className="sprint-progress-loading">Loading sprint progress</div>
      </section>
    );
  }

  if (errorState) {
    return (
      <section className="sprint-progress-card sprint-progress-card-error">
        <h2>{errorState.title}</h2>
        <p>{errorState.message}</p>
      </section>
    );
  }

  const isReadOnly = isReadOnlySprintProgress(progress);

  return (
    <section className="sprint-progress-card">
      <div className="sprint-progress-header">
        <div>
          <h2>Sprint Progress</h2>
          <p>Read-only contribution metrics from JIRA story points and GitHub merged PR validation.</p>
        </div>
        {isReadOnly && <span className="sprint-progress-badge">Read-only</span>}
      </div>

      <div className="sprint-progress-meta">
        <span>Group: {progress?.groupId ?? groupId}</span>
        <span>Sprint: {progress?.sprintId ?? sprintId}</span>
        <span>Student: {progress?.studentId ?? 'Current student'}</span>
      </div>

      <div className="sprint-progress-grid">
        <MetricTile label="Completed Story Points" value={progress?.completedStoryPoints} />
        <MetricTile label="Target Story Points" value={progress?.targetStoryPoints} />
        <MetricTile label="Contribution Ratio" value={progress?.contributionRatio} />
        <MetricTile label="Group Total Story Points" value={progress?.groupTotalStoryPoints} />
      </div>

      <div className="sprint-progress-details">
        <div className="sprint-progress-row">
          <span>GitHub username</span>
          <strong>{progress?.githubUsername || 'Not mapped'}</strong>
        </div>
        <div className="sprint-progress-row">
          <span>Last computed</span>
          <strong>{formatDateTime(progress?.recalculatedAt || progress?.updatedAt)}</strong>
        </div>
        <div className="sprint-progress-row">
          <span>Target configuration applied</span>
          <strong>
            {progress?.basedOnTargets == null
              ? 'Not available'
              : progress.basedOnTargets === false
                ? 'No'
                : 'Yes'}
          </strong>
        </div>
      </div>
    </section>
  );
};

export default SprintProgressCard;
