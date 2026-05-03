import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getGroupApprovalSummary, publishFinalGrades } from '../api/finalGradeService';
import './CoordinatorFinalGradePublishPanel.css';

const CoordinatorFinalGradePublishPanel = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [summaryData, setSummaryData] = useState(null);
  const [error, setError] = useState(null);

  // Publish Modal State
  const [showModal, setShowModal] = useState(false);
  const [publishCycle, setPublishCycle] = useState(null);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [notifyPush, setNotifyPush] = useState(false);
  
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [publishErrorType, setPublishErrorType] = useState('general');

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
  const publishBlockedReason = approvedCount === 0
    ? 'No approved grades found yet. First generate preview and approve grades.'
    : publishedCount > 0
      ? 'These grades are already published for this cycle.'
      : !publishCycle
        ? 'Publish cycle is missing. Refresh the page and re-open from approval flow.'
        : 'A valid approval snapshot is required before publish.';

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    setPublishErrorType('general');
    try {
      const payload = {
        publishCycle,
        notificationFlags: {
          email: notifyEmail,
          sms: notifySms,
          push: notifyPush
        }
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
          <h2>🎉 Published Summary</h2>
          <p>The final grades have been successfully published.</p>
          <div className="publish-stats">
            <div><strong>Group:</strong> {publishResult.groupId}</div>
            <div><strong>Cycle:</strong> {publishResult.publishCycle}</div>
            <div><strong>Grades Published:</strong> {publishResult.publishedCount}</div>
            <div><strong>Timestamp:</strong> {new Date(publishResult.publishedAt).toLocaleString()}</div>
          </div>
          <div className="notification-stats">
            <h3>Notification Status</h3>
            <ul>
              <li>Email: {publishResult.notificationStatus?.email ? 'Sent' : 'Skipped'}</li>
              <li>SMS: {publishResult.notificationStatus?.sms ? 'Sent' : 'Skipped'}</li>
              <li>Push: {publishResult.notificationStatus?.push ? 'Sent' : 'Skipped'}</li>
            </ul>
          </div>
          <button className="btn-primary" onClick={() => navigate('/coordinator')}>Return to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="publish-panel-container">
      <header className="publish-header">
        <h1>Publish Final Grades</h1>
        <p>Group {groupId}</p>
      </header>

      {loading && <div className="loading-state">Loading summary...</div>}
      
      {!loading && error && <div className="error-state">{error}</div>}

      {!loading && !error && (
        <div className="summary-dashboard">
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
              className={`btn-publish ${!canPublish ? 'disabled' : ''}`} 
              onClick={() => setShowModal(true)}
              disabled={!canPublish}
            >
              Publish Final Grades
            </button>
            {!canPublish && (
              <p className="action-hint">
                {publishBlockedReason}
              </p>
            )}
            {!canPublish && (
              <Link className="btn-publish" to={`/groups/${groupId}/final-grades/approval`}>
                Go to Review & Approve
              </Link>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Confirm Publication</h2>
            <p>You are about to publish <strong>{approvedCount}</strong> approved grades for group {groupId}.</p>
            
            <div className="form-group">
              <label>Publish Cycle</label>
              <div className="readonly-value">{publishCycle || 'Not available'}</div>
            </div>

            <div className="notification-options">
              <label className="checkbox-label">
                <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
                Send Email Notifications
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={notifySms} onChange={(e) => setNotifySms(e.target.checked)} />
                Send SMS Notifications
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} />
                Send Push Notifications
              </label>
            </div>

            {publishError && (
              <div className={`error-message ${publishErrorType === 'cycle' ? 'error-message-warning' : ''}`}>
                <span className="error-icon" aria-hidden="true">
                  {publishErrorType === 'cycle' ? '⚠️' : '❌'}
                </span>
                <span>{publishError}</span>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowModal(false)} disabled={publishing}>Cancel</button>
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
