import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getCommittee, addJuryMembers, getProfessorsForJury } from '../api/committeeService';
import './JuryAssignmentForm.css';

/**
 * JuryAssignmentForm — Process 4.3
 * 
 * Allows the Coordinator to assign jury members to a committee.
 * [Critical Fix] Prevents selecting professors who are already advisors on this committee.
 * [Merged] Includes search, select all, and clear functionality from remote branch.
 */
const JuryAssignmentForm = () => {
  const { committeeId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [committee, setCommittee] = useState(null);
  const [professors, setProfessors] = useState([]);
  const [selectedProfessors, setSelectedProfessors] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [professorsLoading, setProfessorsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [error, setError] = useState(null);
  const [committeeError, setCommitteeError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);

  // ── Role guard (UI layer) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || user.role !== 'coordinator') {
      // Handled in render but good to have here
    }
  }, [user]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setCommitteeError(null);
    try {
      const [committeeData, profData] = await Promise.all([
        getCommittee(committeeId),
        getProfessorsForJury().catch(() => [])
      ]);
      setCommittee(committeeData);
      setProfessors(profData || []);
      
      // Pre-select existing jury members
      if (committeeData.juryIds) {
        setSelectedProfessors(committeeData.juryIds);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setCommitteeError(`Committee "${committeeId}" was not found.`);
      } else {
        setCommitteeError('Failed to load committee or professor data.');
      }
      console.error(err);
    } finally {
      setLoading(false);
      setProfessorsLoading(false);
    }
  }, [committeeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const advisorSet = new Set(committee?.advisorIds || []);
  const existingJurySet = new Set(committee?.juryIds || []);

  const filteredProfessors = professors.filter((p) => {
    const q = searchQuery.toLowerCase();
    const fullName = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
    return (
      p.userId.toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      fullName.includes(q)
    );
  });

  const toggleProfessor = (profId) => {
    if (advisorSet.has(profId)) return; // [Critical] Cannot select advisors
    
    setSelectedProfessors(prev => 
      prev.includes(profId) 
        ? prev.filter(id => id !== profId) 
        : [...prev, profId]
    );
    setError(null);
  };

  const handleSelectAll = () => {
    const selectable = filteredProfessors
      .filter((p) => !advisorSet.has(p.userId))
      .map((p) => p.userId);
    
    setSelectedProfessors((prev) => {
      const combined = new Set([...prev, ...selectable]);
      return [...combined];
    });
  };

  const handleClearSelection = () => {
    setSelectedProfessors([]);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await addJuryMembers(committeeId, selectedProfessors);
      setSuccessResult(result);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message;
      
      if (status === 403) {
        setError('You do not have permission to assign jury members.');
      } else if (status === 409) {
        setError(msg || 'Conflict: some professors are already assigned elsewhere.');
      } else {
        setError(msg || 'Failed to update jury members.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render Guards ─────────────────────────────────────────────────────────
  if (!user || user.role !== 'coordinator') {
    return (
      <div className="jury-page">
        <div className="jury-card">
          <div className="jury-error">Access Denied — This page is restricted to Coordinators only.</div>
          <div className="jury-actions">
            <button className="btn-secondary" onClick={() => navigate(-1)}>← Go Back</button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="jury-page"><div className="jury-card">Loading...</div></div>;
  
  if (committeeError) {
    return (
      <div className="jury-page">
        <div className="jury-card">
          <div className="jury-error">{committeeError}</div>
          <div className="jury-actions">
            <button className="btn-secondary" onClick={() => navigate('/coordinator')}>← Back to Panel</button>
          </div>
        </div>
      </div>
    );
  }

  if (successResult) {
    return (
      <div className="jury-page">
        <div className="jury-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', color: '#2ea44f', marginBottom: '16px' }}>✓</div>
          <h1 className="jury-title">Jury Members Assigned!</h1>
          <p className="jury-subtitle">
            <strong>{successResult.committeeName}</strong> now has <strong>{successResult.juryIds.length}</strong> jury members assigned.
          </p>
          <div className="jury-actions" style={{ justifyContent: 'center', marginTop: '24px' }}>
            <button className="btn-primary" onClick={() => navigate('/coordinator')}>Back to Coordinator Panel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="jury-page">
      <div className="jury-card">
        <button className="jury-back" onClick={() => navigate('/coordinator')}>
          ← Back to Coordinator Panel
        </button>

        <h1 className="jury-title">Jury Assignment</h1>
        <p className="jury-subtitle">
          Assign jury members to <strong>{committee.committeeName}</strong>. 
          The jury list will be forwarded to Process 4.4 for validation.
        </p>

        {error && <div className="jury-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Search and Quick Actions */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
            <input
              type="text"
              className="jury-search-input"
              placeholder="Search professors by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ 
                flex: 1, 
                padding: '8px 12px', 
                border: '1px solid #e1e4e8', 
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
            <button type="button" className="btn-secondary" onClick={handleSelectAll} style={{ padding: '8px 12px', fontSize: '12px' }}>
              Select All
            </button>
            <button type="button" className="btn-secondary" onClick={handleClearSelection} style={{ padding: '8px 12px', fontSize: '12px' }}>
              Clear
            </button>
          </div>

          {selectedProfessors.length > 0 && (
            <div style={{ marginBottom: '12px', fontSize: '13px', color: '#0366d6', fontWeight: '600' }}>
              ⚖️ {selectedProfessors.length} professor{selectedProfessors.length !== 1 ? 's' : ''} selected
            </div>
          )}

          <div className="jury-list">
            {filteredProfessors.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#586069' }}>
                {searchQuery ? `No professors match "${searchQuery}"` : 'No professors available.'}
              </div>
            ) : (
              filteredProfessors.map(prof => {
                const isAdvisor = advisorSet.has(prof.userId);
                const isAlreadyJury = existingJurySet.has(prof.userId);
                const selected = selectedProfessors.includes(prof.userId);
                
                return (
                  <div 
                    key={prof.userId} 
                    className={`jury-item ${isAdvisor ? 'jury-item--disabled' : ''} ${selected ? 'jury-item--selected' : ''}`}
                    onClick={() => !isAdvisor && toggleProfessor(prof.userId)}
                    style={{ cursor: isAdvisor ? 'default' : 'pointer' }}
                  >
                    <div className="jury-label">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {}} // Handled by div onClick
                        disabled={isAdvisor || isSubmitting}
                        onClick={(e) => e.stopPropagation()}
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
                    </div>
                  </div>
                );
              })
            )}
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
              disabled={isSubmitting || selectedProfessors.length === 0}
            >
              {isSubmitting ? 'Saving...' : `Save ${selectedProfessors.length > 0 ? `${selectedProfessors.length} ` : ''}Jury Assignment`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JuryAssignmentForm;
