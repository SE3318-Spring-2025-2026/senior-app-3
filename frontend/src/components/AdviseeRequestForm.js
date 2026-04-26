import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getGroup } from '../api/groupService';
import {
  getProfessors,
  submitAdvisorRequest,
  checkAdvisorWindow,
  cancelAdvisorRequest,
} from '../api/advisorService';
import { normalizeGroupId } from '../utils/groupId';
import './AdviseeRequestForm.css';

/**
 * Team leader submits a request for a faculty advisor
 */
const AdviseeRequestForm = () => {
  const { group_id: groupIdParam } = useParams();
  const groupId = normalizeGroupId(groupIdParam);
  const isReservedGroupRoute = String(groupIdParam || '').toLowerCase() === 'new';
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [professors, setProfessors] = useState([]);
  const [selectedProfessor, setSelectedProfessor] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [windowInfo, setWindowInfo] = useState({ open: null });
  const [scheduleBoundaryLocked, setScheduleBoundaryLocked] = useState(false);
  const [pendingConflict, setPendingConflict] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const devBypass = localStorage.getItem('DEV_BYPASS') === 'true';

  useEffect(() => {
    if (!groupId || !user?.userId || isReservedGroupRoute) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 1. Security Check: Verify group membership and leader status
        const group = await getGroup(groupId);
        if (group.leaderId !== user.userId) {
          // Redirect if not the leader
          navigate(`/groups/${groupId}`, { replace: true });
          return;
        }

        // 2. Fetch required data in parallel
        const [profList, winStatus] = await Promise.all([
          getProfessors(),
          checkAdvisorWindow(),
        ]);
        
        setProfessors(profList);
        const effectiveOpen = Boolean(winStatus?.open) || devBypass;
        setWindowInfo({ ...winStatus, open: effectiveOpen });

        if (!effectiveOpen) {
          setError('The advisor association window is currently closed.');
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setError('Failed to load required information. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [groupId, user?.userId, navigate, devBypass, isReservedGroupRoute]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!groupId) {
      setError('Missing group context. Open this page from a valid group dashboard.');
      return;
    }
    if (!selectedProfessor) return;

    setIsSubmitting(true);
    setError(null);
    setPendingConflict(null);

    try {
      await submitAdvisorRequest({
        groupId,
        professorId: selectedProfessor,
        message: message.trim() || undefined
      });
      
      setSuccess(true);
      
      // Redirect after success
      setTimeout(() => {
        navigate(`/groups/${groupId}`);
      }, 3000);
      
    } catch (err) {
      console.error('Submission failed:', err);

      const status = err.response?.status;
      if (status === 403) {
        setError('You must be the team leader to perform this action.');
      } else if (status === 422) {
        if (devBypass) {
          setError('Schedule validation failed on server despite bypass mode. Ask coordinator to open advisor_association window.');
        } else {
          setError('The advisor request window is currently closed.');
          setScheduleBoundaryLocked(true);
        }
      } else if (status === 409) {
        const data = err.response?.data || {};
        const code = data.code;
        const msg = data.message;
        if (code === 'GROUP_ALREADY_HAS_ADVISOR') {
          const profLabel = data.assignedProfessorName || data.assignedProfessorEmail || data.assignedProfessorId;
          setError(
            profLabel
              ? `This group already has an assigned advisor (${profLabel}).`
              : (msg || 'This group already has an assigned advisor.')
          );
        } else if (code === 'ADVISOR_REQUEST_PENDING') {
          const profLabel = data.pendingProfessorName || data.pendingProfessorEmail || data.pendingProfessorId;
          setError(
            profLabel
              ? `A pending advisor request already exists for ${profLabel}. Wait for their decision, ask the coordinator to approve/reject, or cancel it below to send a new one.`
              : (msg || 'A pending advisor request already exists. Wait for a decision or cancel it below before submitting another.')
          );
          if (data.pendingRequestId) {
            setPendingConflict({
              requestId: data.pendingRequestId,
              professorId: data.pendingProfessorId || null,
              professorLabel: profLabel || null,
              createdAt: data.pendingCreatedAt || null,
            });
          }
        } else {
          setError(msg || 'Your group already has a pending request or an assigned advisor.');
        }
      } else {
        setError(err.response?.data?.message || 'Failed to submit the request.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPending = async () => {
    if (!pendingConflict?.requestId) return;
    const ok = window.confirm(
      `Cancel the pending advisor request${
        pendingConflict.professorLabel ? ` to ${pendingConflict.professorLabel}` : ''
      }? You can immediately submit a new one afterwards.`
    );
    if (!ok) return;
    setIsCancelling(true);
    try {
      await cancelAdvisorRequest(pendingConflict.requestId);
      setError(null);
      setPendingConflict(null);
    } catch (err) {
      console.error('Failed to cancel pending advisor request:', err);
      const status = err.response?.status;
      const data = err.response?.data || {};
      if (status === 404) {
        setError('That pending request no longer exists. You can submit a new one now.');
        setPendingConflict(null);
      } else if (status === 409 && data.code === 'NOT_PENDING') {
        setError(`Request can no longer be cancelled (${data.message || 'already processed'}).`);
        setPendingConflict(null);
      } else if (status === 403) {
        setError('Only the team leader (or coordinator) can cancel this advisor request.');
      } else {
        setError(data.message || 'Failed to cancel the pending request. Please try again.');
      }
    } finally {
      setIsCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="advisee-request-page">
        <div className="form-container loading">
          <div className="spinner"></div>
          <p>Loading advisor association details...</p>
        </div>
      </div>
    );
  }

  if (!groupId || isReservedGroupRoute) {
    return (
      <div className="advisee-request-page">
        <div className="form-container">
          <div className="error-banner">
            Missing group context. Please open Advisor Request from a real group dashboard.
          </div>
          <div className="form-actions" style={{ marginTop: '12px' }}>
            <button type="button" className="cancel-btn" onClick={() => navigate('/dashboard')}>
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="advisee-request-page">
        <div className="form-container success">
          <div className="success-icon">✓</div>
          <h2>Request Submitted!</h2>
          <p>Your advisee request has been sent to the professor for review.</p>
          <p className="redirect-hint">Redirecting you back to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="advisee-request-page">
      <div className="form-container">
        <header className="form-header">
          <h1>Request Advisor</h1>
          <p>Select a professor to request as an advisor for your group.</p>
        </header>

        {!windowInfo.open && windowInfo.open !== null && (
          <div className="warning-banner">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>The association window is closed. Submissions are temporarily disabled.</span>
          </div>
        )}
        {devBypass && (
          <div className="warning-banner">
            <span>DEV_BYPASS is enabled. Frontend schedule lock is bypassed for testing.</span>
          </div>
        )}

        {error && (
          <div className="error-banner">
            <div>{error}</div>
            {pendingConflict?.requestId && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={handleCancelPending}
                  disabled={isCancelling}
                  style={{ padding: '4px 10px' }}
                >
                  {isCancelling
                    ? 'Cancelling...'
                    : `Cancel pending request${
                        pendingConflict.professorLabel ? ` to ${pendingConflict.professorLabel}` : ''
                      }`}
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="advisor-form">
          <div className="form-group">
            <label htmlFor="professor">Select Professor</label>
            <select
              id="professor"
              value={selectedProfessor}
              onChange={(e) => setSelectedProfessor(e.target.value)}
              required
              disabled={(!windowInfo.open || scheduleBoundaryLocked) && !devBypass ? true : isSubmitting}
            >
              <option value="">-- Choose a Professor --</option>
              {professors.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="message">Message (Optional)</label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Explain your project goals or why you'd like this professor to advise you..."
              rows="4"
              disabled={(!windowInfo.open || scheduleBoundaryLocked) && !devBypass ? true : isSubmitting}
            ></textarea>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="cancel-btn"
              onClick={() => navigate(`/groups/${groupId}`)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="submit-btn"
              disabled={(!windowInfo.open || scheduleBoundaryLocked) && !devBypass ? true : (!selectedProfessor || isSubmitting)}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdviseeRequestForm;