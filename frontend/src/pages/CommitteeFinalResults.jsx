import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getCommitteeFinalResults } from '../api/finalGradeService';
import './CommitteeFinalResults.css';

const formatDateTime = (value) => {
  if (!value) return 'Not published yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatNumber = (value, fractionDigits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'N/A';
  return number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
};

const resolveError = (error) => {
  const status = error?.response?.status;
  const code = error?.code;

  if (status === 403 || code === 'FORBIDDEN') {
    return {
      title: 'Access denied',
      message: 'Only assigned committee members can view published final results for this committee.',
    };
  }

  if (status === 404) {
    return {
      title: 'No published results found',
      message: 'This committee does not have published final grade results yet.',
    };
  }

  return {
    title: 'Unable to load final results',
    message: error?.response?.data?.message || error?.message || 'Please refresh and try again.',
  };
};

const getStudentLabel = (entry) =>
  entry.studentName || entry.studentFullName || entry.studentEmail || entry.studentId || 'Unknown student';

const CommitteeFinalResults = () => {
  const { committeeId } = useParams();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadResults = async ({ isRefresh = false } = {}) => {
    if (!committeeId) return;

    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setError(null);
    try {
      const data = await getCommitteeFinalResults(committeeId);
      setResults(data);
    } catch (err) {
      setResults(null);
      setError(resolveError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committeeId]);

  const finalGrades = useMemo(
    () =>
      (Array.isArray(results?.finalGrades) ? results.finalGrades : []).filter(
        (entry) => !entry.status || entry.status === 'published'
      ),
    [results]
  );

  const latestPublishedAt = useMemo(() => {
    if (results?.publishedAt) return results.publishedAt;

    const sortedDates = finalGrades
      .map((entry) => entry.publishedAt || entry.createdAt)
      .filter(Boolean)
      .sort();

    return sortedDates[sortedDates.length - 1];
  }, [finalGrades, results]);

  return (
    <div className="committee-results-page" data-testid="committee-final-results-page">
      <header className="committee-results-header">
        <div>
          <p className="committee-results-kicker">Read-only final results</p>
          <h1>Committee Final Results</h1>
          <p className="committee-results-meta">Committee {results?.committeeId || committeeId}</p>
        </div>
        <button
          type="button"
          className="committee-results-button"
          onClick={() => loadResults({ isRefresh: true })}
          disabled={loading || refreshing}
        >
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      {loading && (
        <div className="committee-results-state" role="status" data-testid="committee-final-results-loading">
          Loading published final results
        </div>
      )}

      {!loading && error && (
        <div className="committee-results-error" role="alert">
          <h2>{error.title}</h2>
          <p>{error.message}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <section
            className="committee-results-metrics"
            aria-label="Published result metrics"
            data-testid="committee-results-metrics"
          >
            <div>
              <span className="metric-label">Published records</span>
              <strong>{finalGrades.length}</strong>
            </div>
            <div>
              <span className="metric-label">Last published</span>
              <strong>{formatDateTime(latestPublishedAt)}</strong>
            </div>
          </section>

          <section className="committee-results-panel">
            <div className="committee-results-panel-header">
              <div>
                <h2>Published final grades</h2>
                <p>Draft previews and approval states are excluded from this view.</p>
              </div>
            </div>

            {finalGrades.length === 0 ? (
              <div className="committee-results-empty">
                No published final grade records were returned for this committee.
              </div>
            ) : (
              <div className="committee-results-table-wrap">
                <table className="committee-results-table" data-testid="committee-final-results-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Group</th>
                      <th>Final grade</th>
                      <th>Base score</th>
                      <th>Ratio</th>
                      <th>Published at</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalGrades.map((entry) => (
                      <tr
                        key={`${entry.groupId || 'group'}-${entry.studentId}`}
                        data-testid={`committee-grade-row-${entry.studentId || 'unknown'}`}
                      >
                        <td>
                          <span className="student-label">{getStudentLabel(entry)}</span>
                          {entry.studentId && <span className="student-id">{entry.studentId}</span>}
                        </td>
                        <td>{entry.groupName || entry.groupId || 'N/A'}</td>
                        <td>{formatNumber(entry.finalGrade)}</td>
                        <td>{formatNumber(entry.baseGroupScore)}</td>
                        <td>{formatNumber(entry.individualRatio ?? entry.contributionRatio, 4)}</td>
                        <td>{formatDateTime(entry.publishedAt || entry.createdAt)}</td>
                        <td>
                          <span className="published-badge" data-testid="committee-grade-status">
                            {entry.status || 'published'}
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

export default CommitteeFinalResults;
