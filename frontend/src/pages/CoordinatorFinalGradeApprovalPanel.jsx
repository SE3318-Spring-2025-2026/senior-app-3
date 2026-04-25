import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { approveFinalGrades, previewFinalGrades } from '../api/finalGradeService';
import './CoordinatorFinalGradeApprovalPanel.css';

const formatNumber = (value, fractionDigits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
};

const resolveApiError = (error, fallback) => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const message = data?.message || data?.error || error?.message;

  if (status === 403 || error?.code === 'FORBIDDEN' || error?.code === 'UNAUTHORIZED_ROLE') {
    return 'Forbidden - only the Coordinator role may approve final grades';
  }

  if (status === 404) {
    return message || 'Final grade preview data is missing. Generate a preview after prerequisite grades and ratios are ready.';
  }

  if (status === 409) {
    return message || 'These grades are already approved, rejected, published, or otherwise locked.';
  }

  if (status === 422) {
    return message || 'Please check the approval fields and try again.';
  }

  return message || fallback;
};

const normalizeStudents = (preview) => (Array.isArray(preview?.students) ? preview.students : []);

const CoordinatorFinalGradeApprovalPanel = () => {
  const { groupId } = useParams();
  const [preview, setPreview] = useState(null);
  const [publishCycle, setPublishCycle] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [approvalResult, setApprovalResult] = useState(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [overrides, setOverrides] = useState({});
  const [activeStudent, setActiveStudent] = useState(null);
  const [overrideGrade, setOverrideGrade] = useState('');
  const [overrideComment, setOverrideComment] = useState('');
  const [overrideError, setOverrideError] = useState('');

  const students = useMemo(() => normalizeStudents(preview), [preview]);
  const overrideCount = Object.keys(overrides).length;

  const handleGeneratePreview = async () => {
    setLoadingPreview(true);
    setError('');
    setApprovalResult(null);

    try {
      const data = await previewFinalGrades(groupId, {
        persistForApproval: true,
        publishCycle: publishCycle.trim() || undefined,
        useLatestRatios: false,
      });
      setPreview(data);
      setPublishCycle(data.publishCycle || publishCycle);
      setOverrides({});
    } catch (err) {
      setError(resolveApiError(err, 'Failed to generate final grade preview.'));
    } finally {
      setLoadingPreview(false);
    }
  };

  const openOverrideModal = (student) => {
    const existing = overrides[student.studentId];
    setActiveStudent(student);
    setOverrideGrade(existing?.overriddenFinalGrade ?? '');
    setOverrideComment(existing?.comment ?? '');
    setOverrideError('');
  };

  const closeOverrideModal = () => {
    setActiveStudent(null);
    setOverrideGrade('');
    setOverrideComment('');
    setOverrideError('');
  };

  const saveOverride = () => {
    if (!activeStudent) return;

    const nextGrade = Number(overrideGrade);
    const originalGrade = Number(activeStudent.computedFinalGrade);

    if (!Number.isFinite(nextGrade) || nextGrade < 0 || nextGrade > 100) {
      setOverrideError('Override grade must be a number between 0 and 100.');
      return;
    }

    if (Number.isFinite(originalGrade) && nextGrade === originalGrade) {
      setOverrideError('Override grade must differ from the computed grade.');
      return;
    }

    if (!overrideComment.trim()) {
      setOverrideError('Override reason is required.');
      return;
    }

    setOverrides((current) => ({
      ...current,
      [activeStudent.studentId]: {
        studentId: activeStudent.studentId,
        originalFinalGrade: activeStudent.computedFinalGrade,
        overriddenFinalGrade: nextGrade,
        comment: overrideComment.trim(),
      },
    }));
    closeOverrideModal();
  };

  const removeOverride = (studentId) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[studentId];
      return next;
    });
  };

  const submitDecision = async (decision) => {
    setSubmitting(true);
    setError('');
    setApprovalResult(null);

    try {
      const payload = {
        publishCycle,
        decision,
        reason: decision === 'reject' ? rejectReason.trim() : decisionReason.trim(),
        overrideEntries: decision === 'approve' ? Object.values(overrides) : [],
      };

      const result = await approveFinalGrades(groupId, payload);
      setApprovalResult(result);
    } catch (err) {
      setError(resolveApiError(err, `Failed to ${decision} final grades.`));
    } finally {
      setSubmitting(false);
    }
  };

  if (approvalResult) {
    return (
      <div className="approval-page">
        <section className="approval-result" aria-live="polite">
          <p className="approval-kicker">Approval snapshot recorded</p>
          <h1>{approvalResult.decision === 'reject' ? 'Grades Rejected' : 'Grades Approved'}</h1>
          <dl className="approval-result-grid">
            <div>
              <dt>Group</dt>
              <dd>{approvalResult.groupId || groupId}</dd>
            </div>
            <div>
              <dt>Publish cycle</dt>
              <dd>{approvalResult.publishCycle || publishCycle}</dd>
            </div>
            <div>
              <dt>Students</dt>
              <dd>{approvalResult.totalStudents ?? students.length}</dd>
            </div>
            <div>
              <dt>Overrides</dt>
              <dd>{approvalResult.overridesApplied ?? 0}</dd>
            </div>
          </dl>
          <p>{approvalResult.message || 'The coordinator decision has been saved.'}</p>
          {approvalResult.decision !== 'reject' && (
            <Link className="approval-primary-link" to={`/groups/${groupId}/final-grades/publish`}>
              Continue to publish
            </Link>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="approval-page">
      <header className="approval-header">
        <div>
          <p className="approval-kicker">Coordinator final grade approval</p>
          <h1>Preview & Approve Grades</h1>
          <p>Group {groupId}</p>
        </div>
        <Link className="approval-secondary-link" to={`/groups/${groupId}/final-grades/publish`}>
          Publish wizard
        </Link>
      </header>

      {error && (
        <div className="approval-alert" role="alert">
          {error}
        </div>
      )}

      {!preview && (
        <section className="approval-empty">
          <h2>Generate an approval preview</h2>
          <p>Build the coordinator review snapshot from the latest deliverable scores and contribution ratios.</p>
          <label htmlFor="publish-cycle">Publish cycle</label>
          <input
            id="publish-cycle"
            type="text"
            value={publishCycle}
            onChange={(event) => setPublishCycle(event.target.value)}
            placeholder="Optional. A cycle ID will be generated."
          />
          <button type="button" onClick={handleGeneratePreview} disabled={loadingPreview}>
            {loadingPreview ? 'Generating preview' : 'Generate Preview'}
          </button>
        </section>
      )}

      {preview && (
        <>
          <section className="approval-summary" aria-label="Preview summary">
            <div>
              <span>Base group score</span>
              <strong>{formatNumber(preview.baseGroupScore)}</strong>
            </div>
            <div>
              <span>Students</span>
              <strong>{students.length}</strong>
            </div>
            <div>
              <span>Publish cycle</span>
              <strong>{publishCycle}</strong>
            </div>
            <div>
              <span>Overrides</span>
              <strong>{overrideCount}</strong>
            </div>
          </section>

          <section className="approval-table-section">
            <div className="approval-section-heading">
              <h2>Student grade review</h2>
              <button type="button" onClick={handleGeneratePreview} disabled={loadingPreview || submitting}>
                {loadingPreview ? 'Refreshing' : 'Regenerate Preview'}
              </button>
            </div>

            <div className="approval-table-wrap">
              <table className="approval-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Contribution ratio</th>
                    <th>Computed grade</th>
                    <th>Override grade</th>
                    <th>Reviewed grade</th>
                    <th>Override reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => {
                    const override = overrides[student.studentId];
                    const reviewedGrade = override?.overriddenFinalGrade ?? student.computedFinalGrade;

                    return (
                      <tr key={student.studentId}>
                        <td>{student.studentId}</td>
                        <td>{formatNumber(student.contributionRatio, 4)}</td>
                        <td>{formatNumber(student.computedFinalGrade)}</td>
                        <td>{override ? formatNumber(override.overriddenFinalGrade) : '-'}</td>
                        <td>{formatNumber(reviewedGrade)}</td>
                        <td>{override?.comment || '-'}</td>
                        <td>
                          <div className="approval-row-actions">
                            <button type="button" onClick={() => openOverrideModal(student)}>
                              {override ? 'Edit' : 'Override'}
                            </button>
                            {override && (
                              <button type="button" className="link-button danger" onClick={() => removeOverride(student.studentId)}>
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="approval-decision-panel">
            <div>
              <label htmlFor="approval-reason">Approval note</label>
              <textarea
                id="approval-reason"
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                placeholder="Optional approval context"
              />
            </div>
            <div>
              <label htmlFor="reject-reason">Reject reason</label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Required context for a rejection decision"
              />
            </div>
            <div className="approval-decision-actions">
              <button
                type="button"
                className="approval-reject"
                onClick={() => submitDecision('reject')}
                disabled={submitting || !publishCycle}
              >
                {submitting ? 'Submitting' : 'Reject'}
              </button>
              <button
                type="button"
                className="approval-approve"
                onClick={() => submitDecision('approve')}
                disabled={submitting || !publishCycle}
              >
                {submitting ? 'Submitting' : 'Approve'}
              </button>
            </div>
          </section>
        </>
      )}

      {activeStudent && (
        <div className="approval-modal-backdrop" role="presentation">
          <div className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="override-title">
            <h2 id="override-title">Student Grade Override</h2>
            <p>Student {activeStudent.studentId}</p>
            <div className="approval-modal-comparison">
              <span>Computed grade</span>
              <strong>{formatNumber(activeStudent.computedFinalGrade)}</strong>
            </div>
            <label htmlFor="override-grade">Override grade</label>
            <input
              id="override-grade"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={overrideGrade}
              onChange={(event) => setOverrideGrade(event.target.value)}
            />
            <label htmlFor="override-comment">Override reason</label>
            <textarea
              id="override-comment"
              value={overrideComment}
              onChange={(event) => setOverrideComment(event.target.value)}
            />
            {overrideError && <div className="approval-modal-error">{overrideError}</div>}
            <div className="approval-modal-actions">
              <button type="button" onClick={closeOverrideModal}>Cancel</button>
              <button type="button" className="approval-approve" onClick={saveOverride}>Save Override</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoordinatorFinalGradeApprovalPanel;
