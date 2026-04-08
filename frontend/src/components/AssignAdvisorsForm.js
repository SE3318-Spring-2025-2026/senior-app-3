import React, { useState, useEffect } from 'react';
import { assignAdvisors, getAvailableAdvisors, getCommittee } from '../api/committeeService';
import './AssignAdvisorsForm.css';

/**
 * AssignAdvisorsForm Component
 * 
 * Multi-select form for assigning advisors to a committee draft.
 * Features:
 *   - Fetches available advisors from backend
 *   - Multi-select checkboxes for advisor selection
 *   - Form validation (at least 1 advisor must be selected)
 *   - Error handling with specific error messages (400/403/404/409)
 *   - Success confirmation with updated committee view
 * 
 * Props:
 *   - committeeId: string (required) — Committee ID to assign advisors to
 *   - onSubmitSuccess: function (required) — Callback after successful assignment
 *   - onError: function (optional) — Error callback
 */
const AssignAdvisorsForm = ({ committeeId, onSubmitSuccess, onError }) => {
  // State
  const [advisorPool, setAdvisorPool] = useState([]);
  const [selectedAdvisors, setSelectedAdvisors] = useState(new Set());
  const [committee, setCommittee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Fetch advisors and committee details on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch available advisors and committee details in parallel
        const [advisorsData, committeeData] = await Promise.all([
          getAvailableAdvisors(),
          getCommittee(committeeId),
        ]);

        setAdvisorPool(advisorsData);
        setCommittee(committeeData);

        // Pre-select already assigned advisors
        if (committeeData?.advisorIds && committeeData.advisorIds.length > 0) {
          setSelectedAdvisors(new Set(committeeData.advisorIds));
        }
      } catch (err) {
        const errorMessage = err.message || 'Failed to load advisors';
        setError(errorMessage);
        if (onError) onError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [committeeId, onError]);

  // Handle checkbox toggle
  const handleAdvisorToggle = (advisorId) => {
    setSelectedAdvisors((prev) => {
      const updated = new Set(prev);
      if (updated.has(advisorId)) {
        updated.delete(advisorId);
      } else {
        updated.add(advisorId);
      }
      return updated;
    });
    setError(null); // Clear error when user makes changes
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validation: at least one advisor must be selected
    if (selectedAdvisors.size === 0) {
      setError('Please select at least one advisor');
      return;
    }

    setSubmitting(true);

    try {
      const advisorIds = Array.from(selectedAdvisors);
      const result = await assignAdvisors(committeeId, advisorIds);

      setSuccessMessage(
        `Successfully assigned ${advisorIds.length} advisor(s) to the committee`
      );
      setCommittee(result.committee);

      // Call success callback after a brief delay to allow user to see message
      setTimeout(() => {
        if (onSubmitSuccess) {
          onSubmitSuccess(result.committee);
        }
      }, 1500);
    } catch (err) {
      // Handle specific error codes
      let errorMessage = err.message || 'Failed to assign advisors';

      if (err.code === 400) {
        // Bad request - validation error
        const details = err.details?.errors || [];
        if (details.length > 0) {
          errorMessage = `Invalid advisor(s): ${details.map((e) => e.reason).join(', ')}`;
        } else {
          errorMessage = err.details?.message || 'Invalid request';
        }
      } else if (err.code === 403) {
        errorMessage = 'You do not have permission to assign advisors (coordinator role required)';
      } else if (err.code === 404) {
        errorMessage = `Committee not found: ${committeeId}`;
      } else if (err.code === 409) {
        // Conflict - advisor already assigned
        const conflicts = err.details?.conflicts || [];
        if (conflicts.length > 0) {
          errorMessage = `Advisor conflict: ${conflicts
            .map((c) => `${c.advisorId} already assigned to committee ${c.conflictingCommitteeId}`)
            .join(', ')}`;
        } else {
          errorMessage = 'Advisor conflict detected';
        }
      }

      setError(errorMessage);
      if (onError) onError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="assign-advisors-form-container">
        <div className="loading">Loading advisors...</div>
      </div>
    );
  }

  if (!committee) {
    return (
      <div className="assign-advisors-form-container">
        <div className="error">Failed to load committee details</div>
      </div>
    );
  }

  return (
    <div className="assign-advisors-form-container">
      <div className="form-header">
        <h3>Assign Advisors to Committee</h3>
        <p className="committee-name">{committee.committeeName}</p>
      </div>

      {successMessage && (
        <div className="success-message">
          <span className="icon">✓</span>
          {successMessage}
        </div>
      )}

      {error && (
        <div className="error-message">
          <span className="icon">✕</span>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-section">
          <label className="section-label">
            Select Advisors
            <span className="required">*</span>
          </label>
          <p className="section-description">
            Choose one or more advisors for this committee
          </p>

          {advisorPool.length === 0 ? (
            <div className="no-advisors">
              <p>No advisors available</p>
            </div>
          ) : (
            <div className="advisor-list">
              {advisorPool.map((advisor) => (
                <label key={advisor.userId} className="advisor-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedAdvisors.has(advisor.userId)}
                    onChange={() => handleAdvisorToggle(advisor.userId)}
                    disabled={submitting}
                  />
                  <span className="advisor-info">
                    <span className="advisor-name">{advisor.name || advisor.email}</span>
                    <span className="advisor-email">{advisor.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="selected-count">
            {selectedAdvisors.size} advisor{selectedAdvisors.size !== 1 ? 's' : ''} selected
          </div>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn-submit"
            disabled={submitting || selectedAdvisors.size === 0}
          >
            {submitting ? 'Assigning...' : 'Assign Advisors'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AssignAdvisorsForm;
