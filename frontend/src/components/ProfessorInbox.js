import React, { useState, useEffect } from 'react';
import './ProfessorInbox.css';
import { getMyAdvisorRequests, decideOnAdvisorRequest, checkAdvisorWindow } from '../api/advisorService';
import PageTitle from './PageTitle';

const ProfessorInbox = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [rejectReason, setRejectReason] = useState({});
  const [processingId, setProcessingId] = useState(null);
  const [associationWindowOpen, setAssociationWindowOpen] = useState(null);
  const [associationWindowLocked, setAssociationWindowLocked] = useState(false);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, winStatus] = await Promise.all([
        getMyAdvisorRequests(),
        checkAdvisorWindow(),
      ]);
      setRequests(data);
      setAssociationWindowOpen(winStatus?.open !== false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load requests');
      console.error('Load requests error:', err);
      setAssociationWindowOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (request) => {
    const previousState = requests.find((r) => r.requestId === request.requestId);
    setProcessingId(request.requestId);

    setRequests((prev) =>
      prev.map((r) =>
        r.requestId === request.requestId
          ? { ...r, status: 'approved', decision: 'approve' }
          : r
      )
    );

    try {
      await decideOnAdvisorRequest(request.requestId, 'approve', null);
      setExpandedId(null);
    } catch (err) {
      console.error('Approve error:', err);
      if (err.response?.status === 409) {
        setError(`Request already processed: ${err.response.data.details?.decision}`);
      } else if (err.response?.status === 422) {
        setError('Advisor association window is currently closed.');
        setAssociationWindowLocked(true);
      } else {
        setError(err.response?.data?.message || 'Failed to approve request');
      }

      setRequests((prev) =>
        prev.map((r) =>
          r.requestId === request.requestId
            ? previousState
            : r
        )
      );
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (request) => {
    const reason = rejectReason[request.requestId] || '';

    if (!reason.trim()) {
      setError('Please provide a reason for rejection.');
      return;
    }

    const previousState = requests.find((r) => r.requestId === request.requestId);
    setProcessingId(request.requestId);

    setRequests((prev) =>
      prev.map((r) =>
        r.requestId === request.requestId
          ? { ...r, status: 'rejected', decision: 'reject', reason }
          : r
      )
    );

    try {
      await decideOnAdvisorRequest(request.requestId, 'reject', reason);
      setExpandedId(null);
      setRejectReason({});
    } catch (err) {
      console.error('Reject error:', err);
      if (err.response?.status === 409) {
        setError(`Request already processed: ${err.response.data.details?.decision}`);
      } else if (err.response?.status === 422) {
        setError('Advisor association window is currently closed.');
        setAssociationWindowLocked(true);
      } else {
        setError(err.response?.data?.message || 'Failed to reject request');
      }

      setRequests((prev) =>
        prev.map((r) =>
          r.requestId === request.requestId
            ? previousState
            : r
        )
      );
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter((req) => {
    if (filterStatus === 'all') return true;
    return req.status === filterStatus;
  });

  const statusCounts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
  };

  const decisionsDisabledFor = (request) =>
    associationWindowOpen === false ||
    associationWindowLocked ||
    processingId === request.requestId;

  if (loading) {
    return <div className="professor-inbox loading">Loading requests...</div>;
  }

  return (
    <div className="professor-inbox">
      <div className="professor-inbox-inner">
      <PageTitle
        title="Advisor Requests"
        subtitle="Manage advisee requests for group advisor assignment"
      />

      {error && <div className="error-banner">{error}</div>}

      <div className="inbox-panel">
        <div className="filter-tabs">
          {['all', 'pending', 'approved', 'rejected'].map((status) => (
            <button
              key={status}
              className={`filter-tab ${filterStatus === status ? 'active' : ''}`}
              onClick={() => {
                setFilterStatus(status);
                setError(null);
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
              <span className="count">{statusCounts[status]}</span>
            </button>
          ))}
        </div>

        {filteredRequests.length === 0 ? (
          <div className="empty-state">
            <p>No {filterStatus !== 'all' ? filterStatus : ''} requests</p>
          </div>
        ) : (
          <div className="requests-list">
            {filteredRequests.map((request) => (
            <div
              key={request.requestId}
              className={`request-card ${request.status}`}
            >
              <div
                className="request-header"
                onClick={() =>
                  setExpandedId(
                    expandedId === request.requestId ? null : request.requestId
                  )
                }
              >
                <div className="request-info">
                  <div className="group-name">{request.groupName}</div>
                  <div className="request-details">
                    <span className="leader-email">{request.leaderEmail}</span>
                    <span className={`status-badge ${request.status}`}>
                      {request.status}
                    </span>
                  </div>
                </div>
                <div className="expand-icon">
                  {expandedId === request.requestId ? '▼' : '▶'}
                </div>
              </div>

              {expandedId === request.requestId && (
                <div className="request-expanded">
                  <div className="request-metadata">
                    <p>
                      <strong>Request ID:</strong> {request.requestId}
                    </p>
                    <p>
                      <strong>Requested By:</strong> {request.requesterId}
                    </p>
                    {request.message && (
                      <p>
                        <strong>Message:</strong> {request.message}
                      </p>
                    )}
                    {request.processedAt && (
                      <p>
                        <strong>Processed At:</strong>{' '}
                        {new Date(request.processedAt).toLocaleString()}
                      </p>
                    )}
                    {request.reason && (
                      <p>
                        <strong>Decision Reason:</strong> {request.reason}
                      </p>
                    )}
                  </div>

                  {request.status === 'pending' && (
                    <div className="action-section">
                      <textarea
                        placeholder="Reason for rejection (required if rejecting)"
                        value={rejectReason[request.requestId] || ''}
                        onChange={(e) =>
                          setRejectReason((prev) => ({
                            ...prev,
                            [request.requestId]: e.target.value,
                          }))
                        }
                        className="reject-textarea"
                        disabled={decisionsDisabledFor(request)}
                      />
                      <div className="action-buttons-row">
                        <button
                          className="btn btn-approve"
                          onClick={() => handleApprove(request)}
                          disabled={decisionsDisabledFor(request)}
                        >
                          {processingId === request.requestId ? 'Processing...' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-reject"
                          onClick={() => handleReject(request)}
                          disabled={decisionsDisabledFor(request)}
                        >
                          {processingId === request.requestId ? 'Processing...' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  )}

                  {request.status !== 'pending' && (
                    <div className="decision-info">
                      <p>
                        <strong>Decision:</strong> {request.decision}
                      </p>
                      {request.reason && (
                        <p>
                          <strong>Reason:</strong> {request.reason}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default ProfessorInbox;
