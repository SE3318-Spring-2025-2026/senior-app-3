import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { getCommittee, addJuryMembers, getProfessorsForJury } from '../api/committeeService';
import './JuryAssignmentForm.css';

/**
 * JuryAssignmentForm — Process 4.3 (Release Path)
 *
 * Issue #65: The Coordinator assigns one or more jury members (professors not
 * acting as advisors) to a committee draft. The jury member list is then
 * forwarded to Process 4.4 for validation alongside the advisor assignments.
 *
 * OpenAPI: POST /committees/{committeeId}/jury
 * DFD Flows: f10 (Coordinator → 4.3), f04 (4.3 → 4.4)
 *
 * Acceptance Criteria:
 *  - Coordinator only (403 for others — enforced on API + UI redirect)
 *  - Committee not found → 404 state
 *  - Invalid jury member IDs → 400 error display
 *  - Conflict (already assigned) → 409 error display
 *  - Success: returns updated committee with full juryIds[]
 *  - Jury list forwarded to Process 4.4 (forwardedToJuryValidation: true)
 */
const JuryAssignmentForm = () => {
  const navigate = useNavigate();
  const { committeeId } = useParams();
  const { user } = useAuthStore();

  // ── Component state ───────────────────────────────────────────────────────
  const [committee, setCommittee] = useState(null);
  const [professors, setProfessors] = useState([]);
  const [selectedJuryIds, setSelectedJuryIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [loading, setLoading] = useState(true);
  const [professorsLoading, setProfessorsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState(null);
  const [committeeError, setCommitteeError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);

  // ── Role guard (UI layer) ─────────────────────────────────────────────────
  if (!user || user.role !== 'coordinator') {
    return (
      <div className="jury-page">
        <div className="jury-card">
          <div className="jury-alert jury-alert--error">
            <span>🚫</span>
            <span>Access Denied — This page is restricted to Coordinators only.</span>
          </div>
          <div className="jury-form__actions" style={{ marginTop: '16px' }}>
            <button
              id="jury-go-back-btn"
              className="jury-btn-cancel"
              onClick={() => navigate(-1)}
            >
              ← Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Load committee & professors ───────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const loadData = useCallback(async () => {
    setLoading(true);
    setCommitteeError(null);
    try {
      const [committeeData, professorList] = await Promise.all([
        getCommittee(committeeId),
        getProfessorsForJury().catch(() => []),
      ]);
      setCommittee(committeeData);
      setProfessors(professorList);
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setCommitteeError(`Committee "${committeeId}" was not found.`);
      } else {
        setCommitteeError('Failed to load committee data. Please try again.');
      }
    } finally {
      setLoading(false);
      setProfessorsLoading(false);
    }
  }, [committeeId]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const alreadyAssignedSet = new Set(committee?.juryIds || []);

  const filteredProfessors = professors.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.userId.toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q)
    );
  });

  const isSelected = (userId) => selectedJuryIds.includes(userId);
  const isAlreadyAssigned = (userId) => alreadyAssignedSet.has(userId);

  const toggleSelect = (userId) => {
    if (isAlreadyAssigned(userId)) return; // cannot re-select already assigned
    setSelectedJuryIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
    setError(null);
  };

  const handleSelectAll = () => {
    const selectable = filteredProfessors
      .filter((p) => !isAlreadyAssigned(p.userId))
      .map((p) => p.userId);
    setSelectedJuryIds((prev) => {
      const combined = new Set([...prev, ...selectable]);
      return [...combined];
    });
  };

  const handleClearSelection = () => {
    setSelectedJuryIds([]);
    setError(null);
  };

  // ── Form submission ───────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (selectedJuryIds.length === 0) {
      setError('Please select at least one jury member.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await addJuryMembers(committeeId, selectedJuryIds);
      setSuccessResult(result);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message;
      const code = err.response?.data?.code;

      if (status === 403) {
        setError('You do not have permission to assign jury members.');
      } else if (status === 404) {
        setError('Committee not found. It may have been deleted.');
      } else if (status === 400) {
        const invalidIds = err.response?.data?.invalidIds;
        setError(
          msg ||
            `Invalid jury member IDs.${invalidIds ? ` (${invalidIds.join(', ')})` : ''}`
        );
      } else if (status === 409) {
        const conflictingIds = err.response?.data?.conflictingIds;
        setError(
          msg ||
            `Conflict: some professors are already assigned.${
              conflictingIds ? ` (${conflictingIds.join(', ')})` : ''
            }`
        );
      } else {
        setError(msg || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="jury-page">
        <div className="jury-card">
          <div className="jury-loading">
            <div className="jury-spinner" />
            <p>Loading committee data…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Committee not found ───────────────────────────────────────────────────
  if (committeeError) {
    return (
      <div className="jury-page">
        <div className="jury-card">
          <div className="jury-alert jury-alert--error">
            <span>⚠</span>
            <span>{committeeError}</span>
          </div>
          <div className="jury-form__actions" style={{ marginTop: '16px' }}>
            <button
              id="jury-back-btn-error"
              className="jury-btn-cancel"
              onClick={() => navigate('/coordinator')}
            >
              ← Back to Coordinator Panel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (successResult) {
    return (
      <div className="jury-page">
        <div className="jury-card">
          <div className="jury-success">
            <div className="jury-success__icon">✓</div>
            <h2 className="jury-success__title">Jury Members Assigned!</h2>
            <p className="jury-success__body">
              <strong>{successResult.committeeName}</strong> now has{' '}
              <strong>{successResult.juryIds.length}</strong> jury member
              {successResult.juryIds.length !== 1 ? 's' : ''} assigned. The jury list
              has been forwarded to Process 4.4 for validation.
            </p>

            <div className="jury-success__tags">
              {successResult.juryIds.map((id) => (
                <span key={id} className="jury-success__tag">
                  {id}
                </span>
              ))}
            </div>

            <div className="jury-success__flow">
              <span className="jury-flow-badge jury-flow-badge--done">✓ 4.3 Complete</span>
              <span className="jury-flow-arrow">→</span>
              <span className="jury-flow-badge jury-flow-badge--next">4.4 Jury Validation</span>
            </div>

            <div className="jury-form__actions" style={{ justifyContent: 'center', marginTop: '24px' }}>
              <button
                id="jury-assign-more-btn"
                className="jury-btn-cancel"
                onClick={() => {
                  setSuccessResult(null);
                  setSelectedJuryIds([]);
                  loadData();
                }}
              >
                Assign More
              </button>
              <button
                id="jury-go-coordinator-btn"
                className="jury-btn-submit"
                onClick={() => navigate('/coordinator')}
              >
                Back to Coordinator Panel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="jury-page">
      <div className="jury-card">
        {/* Back button */}
        <button
          id="jury-back-btn"
          className="jury-back"
          onClick={() => navigate('/coordinator')}
        >
          ← Coordinator Panel
        </button>

        {/* Header */}
        <div className="jury-card__header">
          <div className="jury-card__icon">⚖️</div>
          <div className="jury-card__badge">
            <span>⚙</span> Process 4.3 — Assign Jury Members
          </div>
          <h1 className="jury-card__title">Jury Assignment</h1>
          <p className="jury-card__subtitle">
            Assign professors as jury members for{' '}
            <strong style={{ color: '#a5b4fc' }}>{committee?.committeeName}</strong>.
            The jury list will be forwarded to Process 4.4 for validation.
          </p>
        </div>

        {/* Committee info strip */}
        <div className="jury-committee-strip">
          <div className="jury-committee-strip__item">
            <span className="jury-committee-strip__label">Committee ID</span>
            <span className="jury-committee-strip__value jury-committee-strip__value--mono">
              {committee?.committeeId}
            </span>
          </div>
          <div className="jury-committee-strip__item">
            <span className="jury-committee-strip__label">Status</span>
            <span className={`jury-status-badge jury-status-badge--${committee?.status}`}>
              {committee?.status}
            </span>
          </div>
          <div className="jury-committee-strip__item">
            <span className="jury-committee-strip__label">Current Jury</span>
            <span className="jury-committee-strip__value">
              {committee?.juryIds?.length || 0} assigned
            </span>
          </div>
          <div className="jury-committee-strip__item">
            <span className="jury-committee-strip__label">Forwarded to 4.4</span>
            <span className="jury-committee-strip__value">
              {committee?.forwardedToJuryValidation ? '✓ Yes' : '— No'}
            </span>
          </div>
        </div>

        <hr className="jury-divider" />

        {/* Error alert */}
        {error && (
          <div id="jury-error-alert" className="jury-alert jury-alert--error">
            <span>⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Already-assigned jury */}
        {alreadyAssignedSet.size > 0 && (
          <div className="jury-assigned-section">
            <p className="jury-assigned-section__label">
              Already assigned jury members ({alreadyAssignedSet.size}):
            </p>
            <div className="jury-assigned-section__tags">
              {[...alreadyAssignedSet].map((id) => (
                <span key={id} className="jury-assigned-tag">
                  {professors.find((p) => p.userId === id)?.email || id}
                </span>
              ))}
            </div>
          </div>
        )}

        <form id="jury-assignment-form" onSubmit={handleSubmit}>
          {/* Search */}
          <div className="jury-search-row">
            <input
              id="jury-search-input"
              type="text"
              className="jury-search-input"
              placeholder="Search professors by name or email…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={submitting}
            />
            <div className="jury-search-actions">
              <button
                type="button"
                id="jury-select-all-btn"
                className="jury-btn-ghost"
                onClick={handleSelectAll}
                disabled={submitting}
              >
                Select All
              </button>
              <button
                type="button"
                id="jury-clear-btn"
                className="jury-btn-ghost"
                onClick={handleClearSelection}
                disabled={submitting || selectedJuryIds.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Selection count */}
          {selectedJuryIds.length > 0 && (
            <div className="jury-selection-count">
              <span>⚖️</span>
              <span>
                <strong>{selectedJuryIds.length}</strong> professor
                {selectedJuryIds.length !== 1 ? 's' : ''} selected
              </span>
            </div>
          )}

          {/* Professor list */}
          <div className="jury-professor-list" id="jury-professor-list">
            {professorsLoading && (
              <div className="jury-loading">
                <div className="jury-spinner" />
                <p>Loading professors…</p>
              </div>
            )}

            {!professorsLoading && filteredProfessors.length === 0 && (
              <div className="jury-empty-state">
                <span>👥</span>
                <p>
                  {searchQuery
                    ? `No professors match "${searchQuery}".`
                    : 'No professors available.'}
                </p>
              </div>
            )}

            {!professorsLoading &&
              filteredProfessors.map((prof) => {
                const assigned = isAlreadyAssigned(prof.userId);
                const selected = isSelected(prof.userId);

                return (
                  <div
                    key={prof.userId}
                    id={`jury-prof-${prof.userId}`}
                    className={`jury-professor-row ${selected ? 'jury-professor-row--selected' : ''} ${assigned ? 'jury-professor-row--assigned' : ''}`}
                    onClick={() => !assigned && toggleSelect(prof.userId)}
                    role="checkbox"
                    aria-checked={selected || assigned}
                    tabIndex={assigned ? -1 : 0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') toggleSelect(prof.userId);
                    }}
                  >
                    <div className="jury-professor-row__check">
                      {assigned ? (
                        <span className="jury-check jury-check--assigned">✓</span>
                      ) : selected ? (
                        <span className="jury-check jury-check--selected">✓</span>
                      ) : (
                        <span className="jury-check jury-check--empty" />
                      )}
                    </div>
                    <div className="jury-professor-row__info">
                      <span className="jury-professor-row__email">
                        {prof.email || prof.userId}
                      </span>
                      <span className="jury-professor-row__id">
                        {prof.userId}
                      </span>
                    </div>
                    {assigned && (
                      <span className="jury-professor-row__badge">Already assigned</span>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Info box */}
          <div className="jury-info-box">
            <span className="jury-info-box__icon">ℹ</span>
            <p className="jury-info-box__text">
              After submission, the jury list will be forwarded to{' '}
              <strong style={{ color: '#a5b4fc' }}>Process 4.4</strong> for validation
              alongside the advisor assignments (DFD flow f04).
            </p>
          </div>

          {/* Actions */}
          <div className="jury-form__actions">
            <button
              id="jury-cancel-btn"
              type="button"
              className="jury-btn-cancel"
              onClick={() => navigate('/coordinator')}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              id="jury-submit-btn"
              type="submit"
              className="jury-btn-submit"
              disabled={submitting || selectedJuryIds.length === 0}
            >
              {submitting ? (
                <>
                  <span className="jury-spinner jury-spinner--small" />
                  Assigning…
                </>
              ) : (
                `⚖️ Assign ${selectedJuryIds.length > 0 ? `${selectedJuryIds.length} ` : ''}Jury Member${selectedJuryIds.length !== 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JuryAssignmentForm;
