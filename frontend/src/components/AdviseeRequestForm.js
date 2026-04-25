import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getGroup } from '../api/groupService';
import { getProfessors, submitAdvisorRequest, checkAdvisorWindow } from '../api/advisorService';
import './PageShell.css';
import './AdviseeRequestForm.css';

/**
 * Team leader submits a request for a faculty advisor
 */
const AdviseeRequestForm = () => {
  const { group_id: groupId } = useParams();
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

  useEffect(() => {
    if (!groupId || !user?.userId) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const group = await getGroup(groupId);
        if (group.leaderId !== user.userId) {
          navigate(`/groups/${groupId}`, { replace: true });
          return;
        }

        const [profList, winStatus] = await Promise.all([
          getProfessors(),
          checkAdvisorWindow(),
        ]);

        setProfessors(profList);
        setWindowInfo(winStatus);

        if (!winStatus.open) {
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
  }, [groupId, user?.userId, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedProfessor) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await submitAdvisorRequest({
        groupId,
        professorId: selectedProfessor,
        message: message.trim() || undefined,
      });

      setSuccess(true);

      setTimeout(() => {
        navigate(`/groups/${groupId}`);
      }, 3000);
    } catch (err) {
      console.error('Submission failed:', err);

      const status = err.response?.status;
      if (status === 403) {
        setError('You must be the team leader to perform this action.');
      } else if (status === 422) {
        setError('The advisor request window is currently closed.');
        setScheduleBoundaryLocked(true);
      } else if (status === 409) {
        setError('Your group already has a pending request or an assigned advisor.');
      } else {
        setError(err.response?.data?.message || 'Failed to submit the request.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="student-page-shell narrow">
        <div className="student-card student-loading">Loading advisor association details...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="student-page-shell narrow">
        <div className="student-card advisee-success-card">
          <div className="success-icon">✓</div>
          <h2>Request Submitted!</h2>
          <p>Your advisee request has been sent to the professor for review.</p>
          <p className="redirect-hint">Redirecting you back to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="student-page-shell narrow">
      <header className="student-page-header">
        <div>
          <p className="student-page-kicker">Groups</p>
          <h1>Request Advisor</h1>
          <p>Select a professor to request as an advisor for your group.</p>
        </div>
      </header>

      <div className="student-card">
        {!windowInfo.open && windowInfo.open !== null && (
          <div className="student-alert warning">
            The association window is closed. Submissions are temporarily disabled.
          </div>
        )}

        {error && <div className="student-alert error">{error}</div>}

        <form onSubmit={handleSubmit} className="student-form advisor-form">
          <div className="student-form-group">
            <label htmlFor="professor">Select Professor</label>
            <select
              id="professor"
              className="student-select"
              value={selectedProfessor}
              onChange={(e) => setSelectedProfessor(e.target.value)}
              required
              disabled={!windowInfo.open || isSubmitting || scheduleBoundaryLocked}
            >
              <option value="">Choose a professor</option>
              {professors.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="student-form-group">
            <label htmlFor="message">Message (Optional)</label>
            <textarea
              id="message"
              className="student-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Explain your project goals or why you'd like this professor to advise you..."
              rows="4"
              disabled={!windowInfo.open || isSubmitting || scheduleBoundaryLocked}
            />
          </div>

          <div className="student-actions">
            <button
              type="button"
              className="student-btn secondary"
              onClick={() => navigate(`/groups/${groupId}`)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="student-btn primary"
              disabled={!windowInfo.open || !selectedProfessor || isSubmitting || scheduleBoundaryLocked}
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
