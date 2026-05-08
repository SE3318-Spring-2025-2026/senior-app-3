import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getGroupApprovalSummary, publishFinalGrades } from '../api/finalGradeService';
import './CoordinatorFinalGradePublishPanel.css';

const CoordinatorFinalGradePublishPanel = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [summaryData, setSummaryData] = useState(null);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [publishCycle, setPublishCycle] = useState(null);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [notifyPush, setNotifyPush] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [publishErrorType, setPublishErrorType] = useState('general');
  const publishButtonRef = useRef(null);
  const modalContentRef = useRef(null);
  const publishingRef = useRef(publishing);
  const prevShowModalRef = useRef(showModal);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGroupApprovalSummary(groupId);
      setSummaryData(data.summary || []);
      setPublishCycle(data.activePublishCycle || null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load approval summary.');
    } finally {
      setLoading(false);
    }
  };

  const approvedCount = summaryData?.find((s) => s._id === 'approved')?.count || 0;
  const publishedCount = summaryData?.find((s) => s._id === 'published')?.count || 0;
  const pendingCount = summaryData?.find((s) => s._id === 'pending')?.count || 0;

  const canPublish = approvedCount > 0 && publishedCount === 0 && Boolean(publishCycle);
  const publishBlockedReason =
    publishedCount > 0
      ? 'These grades are already published for this cycle.'
      : approvedCount === 0
        ? 'No approved grades found yet. First generate a preview and approve grades.'
        : !publishCycle
          ? ''
          : 'A valid approval snapshot is required before publishing.';

  useEffect(() => {
    publishingRef.current = publishing;
  }, [publishing]);

  useEffect(() => {
    if (!showModal) return undefined;

    const modalElement = modalContentRef.current;
    if (!modalElement) return undefined;

    const getFocusable = () =>
      modalElement.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

    const focusableElements = getFocusable();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      modalElement.focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!publishingRef.current) {
          setShowModal(false);
          setPublishError(null);
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const updatedFocusable = getFocusable();
      if (updatedFocusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = updatedFocusable[0];
      const last = updatedFocusable[updatedFocusable.length - 1];
      const active = document.activeElement;

      if (!modalElement.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showModal]);

  useEffect(() => {
    if (prevShowModalRef.current && !showModal) {
      publishButtonRef.current?.focus();
    }
    prevShowModalRef.current = showModal;
  }, [showModal]);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    setPublishErrorType('general');
    try {
      const payload = {
        publishCycle,
        notificationFlags: { email: notifyEmail, sms: notifySms, push: notifyPush },
      };
      const result = await publishFinalGrades(groupId, payload);
      setPublishResult(result);
      setShowModal(false);
      await loadSummary();
    } catch (err) {
      if (err?.response?.status === 409) {
        const errorCode = err?.response?.data?.code;
        const errorMap = {
          ALREADY_PUBLISHED: 'These grades have already been published for this cycle.',
          INCONSISTENT_CYCLE:
            'The selected cycle does not match the approved records. Please refresh the page and try again.',
          DEFAULT: 'A conflict error occurred. Please verify the data and try again.',
        };
        if (errorCode === 'INCONSISTENT_CYCLE') {
          setPublishErrorType('cycle');
        }
        setPublishError(errorMap[errorCode] || errorMap.DEFAULT);
      } else {
        setPublishErrorType('general');
        setPublishError(err?.response?.data?.error || 'Failed to publish grades.');
      }
    } finally {
      setPublishing(false);
    }
  };

  if (publishResult) {
    return (
      <div className="publish-panel-container">
        <div className="publish-success-state">
          <div className="publish-success-icon" aria-hidden="true">&#10003;</div>
          <h2>Grades Published</h2>
          <p>The final grades have been successfully published and students will be notified.</p>
          <div className="publish-stats">
            <div>
              <strong>Group</strong>
              <span>{publishResult.groupId}</span>
            </div>
            <div>
              <strong>Cycle</strong>
              <span>{publishResult.publishCycle}</span>
            </div>
            <div>
              <strong>Grades Published</strong>
              <span>{publishResult.publishedCount}</span>
            </div>
            <div>
              <strong>Published At</strong>
              <span>{new Date(publishResult.publishedAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="notification-stats">
            <h3>Notification Status</h3>
            <ul>
              <li>
                <span>Email</span>
                <span className={`notif-badge ${publishResult.notificationStatus?.email ? 'sent' : 'skipped'}`}>
                  {publishResult.notificationStatus?.email ? 'Sent' : 'Skipped'}
                </span>
              </li>
              <li>
                <span>SMS</span>
                <span className={`notif-badge ${publishResult.notificationStatus?.sms ? 'sent' : 'skipped'}`}>
                  {publishResult.notificationStatus?.sms ? 'Sent' : 'Skipped'}
                </span>
              </li>
              <li>
                <span>Push</span>
                <span className={`notif-badge ${publishResult.notificationStatus?.push ? 'sent' : 'skipped'}`}>
                  {publishResult.notificationStatus?.push ? 'Sent' : 'Skipped'}
                </span>
              </li>
            </ul>
          </div>
          <button className="btn-primary" onClick={() => navigate('/coordinator')}>
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="publish-panel-container">
      <nav className="wizard-steps" aria-label="Publication steps">
        <Link className="wizard-step completed" to={`/groups/${groupId}/final-grades/approval`}>
          <span className="wizard-step-num" aria-hidden="true">1</span>
          <span className="wizard-step-label">Review &amp; Approve</span>
        </Link>
        <div className="wizard-step-connector" aria-hidden="true" />
        <div className="wizard-step active" aria-current="step">
          <span className="wizard-step-num" aria-hidden="true">2</span>
          <span className="wizard-step-label">Publish Grades</span>
        </div>
      </nav>

      <header className="publish-header">
        <div>
          <p className="publish-kicker">Step 2 of 2 &mdash; Coordinator grade publication</p>
          <h1>Publish Final Grades</h1>
          <p>Group {groupId}</p>
        </div>
        <Link className="publish-back-link" to={`/groups/${groupId}/final-grades/approval`}>
          &#8592; Back to Approval
        </Link>
      </header>

      {loading && (
        <div className="loading-state">
          <span className="loading-spinner" aria-hidden="true" />
          Loading approval summary...
        </div>
      )}

      {!loading && error && (
        <div className="error-state" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="summary-dashboard">
          <p className="summary-description">
            Review the grade counts below. All approved grades for this group will be published in a
            single batch and students will be notified through the selected channels.
          </p>

          <div className="summary-cards">
            <div className="card">
              <h3>Pending Approval</h3>
              <p className="count">{pendingCount}</p>
            </div>
            <div className="card approved">
              <h3>Approved (Ready)</h3>
              <p className="count">{approvedCount}</p>
            </div>
            <div className="card published">
              <h3>Already Published</h3>
              <p className="count">{publishedCount}</p>
            </div>
          </div>

          <div className="publish-actions">
            <button
              ref={publishButtonRef}
              className={`btn-publish${!canPublish ? ' disabled' : ''}`}
              onClick={() => setShowModal(true)}
              disabled={!canPublish}
              aria-describedby={!canPublish ? 'publish-blocked-hint' : undefined}
            >
              Publish Final Grades
            </button>
            {!canPublish && (
              <>
                <p id="publish-blocked-hint" className="action-hint">
                  {publishBlockedReason}
                </p>
                {publishedCount === 0 && (
                  <Link
                    className="btn-secondary-link"
                    to={`/groups/${groupId}/final-grades/approval`}
                  >
                    Go to Review &amp; Approve
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="modal-content" ref={modalContentRef} tabIndex={-1}>
            <h2 id="modal-title">Confirm Publication</h2>
            <p>
              You are about to publish <strong>{approvedCount}</strong> approved grades for group{' '}
              {groupId}. This action cannot be undone.
            </p>

            <div className="form-group">
              <label>Publish Cycle</label>
              <div className="readonly-value">{publishCycle || 'Not available'}</div>
            </div>

            <div className="notification-options">
              <p className="notification-options-label">Notify students via:</p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                />
                Email
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={notifySms}
                  onChange={(e) => setNotifySms(e.target.checked)}
                />
                SMS
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={notifyPush}
                  onChange={(e) => setNotifyPush(e.target.checked)}
                />
                Push Notification
              </label>
            </div>

            {publishError && (
              <div
                className={`error-message${publishErrorType === 'cycle' ? ' error-message-warning' : ''}`}
                role="alert"
              >
                <span className="error-icon" aria-hidden="true">
                  {publishErrorType === 'cycle' ? '!' : '×'}
                </span>
                <span>{publishError}</span>
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowModal(false)}
                disabled={publishing}
              >
                Cancel
              </button>
              <button className="btn-confirm" onClick={handlePublish} disabled={publishing}>
                {publishing ? 'Publishing...' : 'Confirm & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoordinatorFinalGradePublishPanel;
