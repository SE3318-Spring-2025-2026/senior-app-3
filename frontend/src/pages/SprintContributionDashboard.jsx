import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSprintContributionSummary } from '../api/sprintContributionService';
import './SprintContributionDashboard.css';

const formatNumber = (value, fractionDigits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
};

const formatDateTime = (value) => {
  if (!value) return 'Not recalculated yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatRatio = (value) => {
  if (value == null || value === '') return '0';
  return String(value);
};

const resolveErrorMessage = (error) => {
  const status = error?.response?.status;
  const code = error?.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return {
      title: 'Access denied',
      message: 'You are not authorized to view sprint contribution summaries for this group.',
    };
  }

  if (status === 404) {
    return {
      title: 'Contribution data not found',
      message: 'No D6-backed contribution summary was found for this group and sprint.',
    };
  }

  if (status === 409) {
    return {
      title: 'Contribution snapshot unavailable',
      message: 'The sprint contribution records are locked or in a conflicting state.',
    };
  }

  return {
    title: 'Unable to load contribution summary',
    message: error?.response?.data?.message || error?.message || 'Please refresh and try again.',
  };
};

const ratioPercent = (ratio) => {
  const number = Number(ratio);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(number * 100, 100));
};

const escapeCsvValue = (value) => {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const buildCsv = (summary, contributions) => {
  const rows = [
    [
      'groupId',
      'sprintId',
      'studentId',
      'githubUsername',
      'completedStoryPoints',
      'targetStoryPoints',
      'groupTotalStoryPoints',
      'contributionRatio',
      'status',
      'recalculatedAt',
    ],
    ...contributions.map((entry) => [
      summary.groupId,
      summary.sprintId,
      entry.studentId,
      entry.githubUsername,
      entry.completedStoryPoints,
      entry.targetStoryPoints,
      entry.groupTotalStoryPoints,
      entry.contributionRatio,
      entry.locked ? 'Locked' : 'Open',
      summary.recalculatedAt,
    ]),
  ];

  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
};

const SprintContributionDashboard = () => {
  const { groupId, sprintId } = useParams();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadSummary = async ({ isRefresh = false } = {}) => {
    if (!groupId || !sprintId) return;

    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setError(null);
    try {
      const data = await getSprintContributionSummary(groupId, sprintId);
      setSummary(data);
    } catch (err) {
      setSummary(null);
      setError(resolveErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, sprintId]);

  const contributions = useMemo(
    () => (Array.isArray(summary?.contributions) ? summary.contributions : []),
    [summary]
  );

  const groupTotalStoryPoints = summary?.groupTotalStoryPoints ?? 0;
  const lockedCount = summary?.lockedCount ?? 0;

  const handleCsvExport = () => {
    if (!summary) return;

    const csv = buildCsv(summary, contributions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${summary.groupId}-${summary.sprintId}-contributions.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sprint-contribution-page">
      <header className="sprint-contribution-header">
        <div>
          <p className="sprint-contribution-kicker">Read-only oversight</p>
          <h1>Sprint Contribution Dashboard</h1>
          <p className="sprint-contribution-meta">
            Group {summary?.groupId || groupId} | Sprint {summary?.sprintId || sprintId}
          </p>
        </div>
        <div className="sprint-contribution-actions">
          <button
            type="button"
            className="sprint-contribution-button secondary"
            onClick={() => loadSummary({ isRefresh: true })}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            type="button"
            className="sprint-contribution-button"
            onClick={handleCsvExport}
            disabled={!summary || contributions.length === 0}
          >
            Export CSV
          </button>
        </div>
      </header>

      {loading && (
        <div className="sprint-contribution-state" role="status">
          Loading contribution summary
        </div>
      )}

      {!loading && error && (
        <div className="sprint-contribution-error" role="alert">
          <h2>{error.title}</h2>
          <p>{error.message}</p>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <section className="sprint-contribution-metrics" aria-label="Contribution summary metrics">
            <div>
              <span className="metric-label">Students</span>
              <strong>{contributions.length}</strong>
            </div>
            <div>
              <span className="metric-label">Group total SP</span>
              <strong>{formatNumber(groupTotalStoryPoints)}</strong>
            </div>
            <div>
              <span className="metric-label">Target model</span>
              <strong>{summary.basedOnTargets ? 'Applied' : 'Not applied'}</strong>
            </div>
            <div>
              <span className="metric-label">Locked rows</span>
              <strong>{lockedCount}</strong>
            </div>
          </section>

          <div className="sprint-contribution-note">
            Trend data is not available from the current Process 7 API, so this view shows the selected sprint only.
          </div>

          <section className="sprint-contribution-panel">
            <div className="sprint-contribution-panel-header">
              <div>
                <h2>Per-student contribution ratios</h2>
                <p>Last recalculated: {formatDateTime(summary.recalculatedAt)}</p>
              </div>
            </div>

            {contributions.length === 0 ? (
              <div className="sprint-contribution-empty">
                No contribution records have been returned for this sprint.
              </div>
            ) : (
              <div className="sprint-contribution-table-wrap">
                <table className="sprint-contribution-table">
                  <thead>
                    <tr>
                      <th>Student ID</th>
                      <th>GitHub</th>
                      <th>Completed SP</th>
                      <th>Target SP</th>
                      <th>Group Total SP</th>
                      <th>Ratio</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributions.map((entry) => (
                      <tr key={`${entry.studentId}-${entry.githubUsername || 'github'}`}>
                        <td>{entry.studentId}</td>
                        <td>{entry.githubUsername || 'Unmapped'}</td>
                        <td>{formatNumber(entry.completedStoryPoints)}</td>
                        <td>{formatNumber(entry.targetStoryPoints)}</td>
                        <td>{formatNumber(entry.groupTotalStoryPoints)}</td>
                        <td>
                          <div className="ratio-cell">
                            <span>{formatRatio(entry.contributionRatio)}</span>
                            <div
                              className="ratio-track"
                              aria-label={`Contribution ratio ${formatRatio(entry.contributionRatio)}`}
                            >
                              <div
                                className="ratio-fill"
                                style={{ width: `${ratioPercent(entry.contributionRatio)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`lock-badge ${entry.locked ? 'locked' : 'open'}`}>
                            {entry.locked ? 'Locked' : 'Open'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default SprintContributionDashboard;
