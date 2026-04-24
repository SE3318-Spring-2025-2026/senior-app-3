import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getFinalGradeReview } from '../api/finalGradeReviewService';
import './FinalGradeReviewPanel.css';

const EMPTY_STATUS = 'preview_unavailable';

const formatNumber = (value, fractionDigits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
};

const formatDateTime = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatStatus = (status, approval) => {
  if (approval?.decision === 'approved') return 'Approved';
  if (approval?.decision === 'rejected') return 'Rejected';

  const labels = {
    preview_ready: 'Preview ready',
    preview_unavailable: 'Preview unavailable',
    approved: 'Approved',
    rejected: 'Rejected',
  };

  return labels[status] || 'Review pending';
};

const normalizeResponse = (data) => {
  const preview = data?.preview || data?.finalGradesPreview || data || null;
  const approval = data?.approval || data?.finalGradeApproval || null;
  const status = data?.status || approval?.decision || (preview?.students ? 'preview_ready' : EMPTY_STATUS);

  return {
    preview,
    approval,
    status,
  };
};

const resolveErrorState = (error) => {
  const status = error?.response?.status;
  const message = error?.response?.data?.message || error?.message;

  if (status === 404) {
    return {
      kind: 'empty',
      title: 'Final grade preview is not available yet',
      message: 'The coordinator needs to generate the final grade preview before professor review can begin.',
    };
  }

  if (status === 403 || error?.code === 'FORBIDDEN') {
    return {
      kind: 'error',
      title: 'Access denied',
      message: message || 'You are not authorized to view this final grade review.',
    };
  }

  if (status === 409) {
    return {
      kind: 'error',
      title: 'Review snapshot is unavailable',
      message: message || 'The final grade configuration is locked or in a conflicting state.',
    };
  }

  return {
    kind: 'error',
    title: 'Unable to load final grade review',
    message: message || 'Please refresh and try again.',
  };
};

const buildOverrideMap = (approval) => {
  const entries = Array.isArray(approval?.overrideEntries) ? approval.overrideEntries : [];
  return entries.reduce((map, entry) => {
    if (entry?.studentId) map.set(entry.studentId, entry);
    return map;
  }, new Map());
};

const formatBreakdown = (breakdown) => {
  if (!breakdown || typeof breakdown !== 'object') return 'No breakdown returned';

  const entries = Object.entries(breakdown);
  if (entries.length === 0) return 'No breakdown returned';

  return entries
    .map(([deliverableId, score]) => `${deliverableId}: ${formatNumber(score)}`)
    .join(', ');
};

const FinalGradeReviewPanel = () => {
  const { groupId } = useParams();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stateMessage, setStateMessage] = useState(null);

  const loadReview = async ({ isRefresh = false } = {}) => {
    if (!groupId) return;

    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setStateMessage(null);

    try {
      const data = await getFinalGradeReview(groupId);
      const normalized = normalizeResponse(data);

      if (normalized.status === EMPTY_STATUS || !Array.isArray(normalized.preview?.students)) {
        setReview(normalized);
        setStateMessage({
          kind: 'empty',
          title: 'Final grade preview is not available yet',
          message: 'The coordinator needs to generate the final grade preview before professor review can begin.',
        });
        return;
      }

      setReview(normalized);
    } catch (error) {
      setReview(null);
      setStateMessage(resolveErrorState(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const preview = review?.preview;
  const approval = review?.approval;
  const students = useMemo(
    () => (Array.isArray(preview?.students) ? preview.students : []),
    [preview]
  );
  const overrideMap = useMemo(() => buildOverrideMap(approval), [approval]);
  const hasOverrides = approval?.overridesApplied || overrideMap.size > 0;

  return (
    <div className="final-grade-review-page">
      <header className="final-grade-review-header">
        <div>
          <p className="final-grade-review-kicker">Read-only grade review</p>
          <h1>Professor Grade Review</h1>
          <p className="final-grade-review-meta">Group {preview?.groupId || groupId}</p>
        </div>
        <button
          type="button"
          className="final-grade-review-button"
          onClick={() => loadReview({ isRefresh: true })}
          disabled={loading || refreshing}
        >
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      {loading && (
        <div className="final-grade-review-state" role="status">
          Loading final grade review
        </div>
      )}

      {!loading && stateMessage && (
        <div
          className={`final-grade-review-message ${stateMessage.kind === 'empty' ? 'empty' : 'error'}`}
          role={stateMessage.kind === 'empty' ? 'status' : 'alert'}
        >
          <h2>{stateMessage.title}</h2>
          <p>{stateMessage.message}</p>
        </div>
      )}

      {!loading && !stateMessage && preview && (
        <>
          <section className="final-grade-review-metrics" aria-label="Final grade review metrics">
            <div>
              <span className="metric-label">Approval status</span>
              <strong>{formatStatus(review.status, approval)}</strong>
            </div>
            <div>
              <span className="metric-label">Base group score</span>
              <strong>{formatNumber(preview.baseGroupScore)}</strong>
            </div>
            <div>
              <span className="metric-label">Preview created</span>
              <strong>{formatDateTime(preview.createdAt)}</strong>
            </div>
            <div>
              <span className="metric-label">Overrides</span>
              <strong>{hasOverrides ? 'Applied' : 'None'}</strong>
            </div>
          </section>

          <section className="final-grade-review-panel">
            <div className="final-grade-review-panel-header">
              <div>
                <h2>Final grade snapshot</h2>
                <p>
                  Approval recorded: {formatDateTime(approval?.approvedAt)}
                  {approval?.coordinatorId ? ` by ${approval.coordinatorId}` : ''}
                </p>
              </div>
            </div>

            {students.length === 0 ? (
              <div className="final-grade-review-empty">
                No student grade entries were returned for this preview.
              </div>
            ) : (
              <div className="final-grade-review-table-wrap">
                <table className="final-grade-review-table">
                  <thead>
                    <tr>
                      <th>Student ID</th>
                      <th>Contribution ratio</th>
                      <th>Computed grade</th>
                      <th>Reviewed grade</th>
                      <th>Override</th>
                      <th>Deliverable breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => {
                      const override = overrideMap.get(student.studentId);
                      const reviewedGrade = override?.overriddenFinalGrade ?? student.computedFinalGrade;

                      return (
                        <tr key={student.studentId}>
                          <td>{student.studentId}</td>
                          <td>{formatNumber(student.contributionRatio, 4)}</td>
                          <td>{formatNumber(student.computedFinalGrade)}</td>
                          <td>{formatNumber(reviewedGrade)}</td>
                          <td>
                            {override ? (
                              <span className="override-badge" title={override.comment || 'Coordinator override applied'}>
                                Override applied
                              </span>
                            ) : (
                              <span className="readonly-badge">Original</span>
                            )}
                            {override?.comment && <p className="override-comment">{override.comment}</p>}
                          </td>
                          <td>{formatBreakdown(student.deliverableScoreBreakdown)}</td>
                        </tr>
                      );
                    })}
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

export default FinalGradeReviewPanel;

