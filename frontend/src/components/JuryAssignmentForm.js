import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCommittee, addJuryMembers } from '../api/committeeService';
import { listProfessors } from '../api/authService';
import './JuryAssignmentForm.css';

/**
 * JuryAssignmentForm — Process 4.3
 * 
 * Allows the Coordinator to assign jury members to a committee.
 * [Critical Fix] Prevents selecting professors who are already advisors on this committee.
 */
const JuryAssignmentForm = () => {
  const { committeeId } = useParams();
  const navigate = useNavigate();

  const [committee, setCommittee] = useState(null);
  const [professors, setProfessors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProfessors, setSelectedProfessors] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [committeeData, profData] = await Promise.all([
          getCommittee(committeeId),
          listProfessors()
        ]);
        setCommittee(committeeData);
        setProfessors(profData.professors || []);
        
        // Pre-select existing jury members
        if (committeeData.juryIds) {
          setSelectedProfessors(committeeData.juryIds);
        }
      } catch (err) {
        setError('Failed to load committee or professor data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [committeeId]);

  const toggleProfessor = (profId) => {
    setSelectedProfessors(prev => 
      prev.includes(profId) 
        ? prev.filter(id => id !== profId) 
        : [...prev, profId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await addJuryMembers(committeeId, selectedProfessors);
      navigate('/coordinator');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update jury members.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="jury-page">Loading...</div>;
  if (!committee) return <div className="jury-page">Committee not found.</div>;

  // [Critical Fix] Create Set of advisor IDs for efficient lookup
  const advisorSet = new Set(committee.advisorIds || []);

  return (
    <div className="jury-page">
      <div className="jury-card">
        <button className="jury-back" onClick={() => navigate('/coordinator')}>
          ← Back
        </button>

        <h1 className="jury-title">Jury Assignment</h1>
        <p className="jury-subtitle">
          Assign jury members to <strong>{committee.committeeName}</strong>
        </p>

        {error && <div className="jury-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="jury-list">
            {professors.map(prof => {
              const isAdvisor = advisorSet.has(prof.userId);
              const isAlreadyJury = (committee.juryIds || []).includes(prof.userId);
              
              return (
                <div 
                  key={prof.userId} 
                  className={`jury-item ${isAdvisor ? 'jury-item--disabled' : ''}`}
                >
                  <label className="jury-label">
                    <input
                      type="checkbox"
                      checked={selectedProfessors.includes(prof.userId)}
                      onChange={() => toggleProfessor(prof.userId)}
                      disabled={isAdvisor || isSubmitting}
                    />
                    <div className="jury-prof-info">
                      <span className="jury-prof-name">
                        {prof.firstName} {prof.lastName}
                      </span>
                      <span className="jury-prof-email">{prof.email}</span>
                    </div>
                    {isAdvisor && (
                      <span className="jury-badge jury-badge--advisor">
                        Committee Advisor
                      </span>
                    )}
                    {isAlreadyJury && !isAdvisor && (
                      <span className="jury-badge jury-badge--existing">
                        Existing Jury
                      </span>
                    )}
                  </label>
                </div>
              );
            })}
          </div>

          <div className="jury-actions">
            <button 
              type="button" 
              className="btn-secondary" 
              onClick={() => navigate('/coordinator')}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Jury Assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JuryAssignmentForm;
