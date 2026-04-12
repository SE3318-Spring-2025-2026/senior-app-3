import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getGroup } from '../api/groupService';
import { getProfessors, submitAdvisorRequest, checkAdvisorWindow } from '../api/advisorService';
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

  useEffect(() => {
    if (!groupId || !user?.userId) return;

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
        setError('The advisor request window is currently closed.');
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
      <div className="advisee-request-page">
        <div className="form-container loading">
          <div className="spinner"></div>
          <p>Loading advisor association details...</p>
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

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit} className="advisor-form">
          <div className="form-group">
            <label htmlFor="professor">Select Professor</label>
            <select
              id="professor"
              value={selectedProfessor}
              onChange={(e) => setSelectedProfessor(e.target.value)}
              required
              disabled={!windowInfo.open || isSubmitting}
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
              disabled={!windowInfo.open || isSubmitting}
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
              disabled={!windowInfo.open || !selectedProfessor || isSubmitting}
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