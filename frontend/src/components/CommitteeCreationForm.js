import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { createCommittee } from '../api/committeeService';
import './CommitteeCreationForm.css';

/**
 * CommitteeCreationForm — Process 4.1 (Release Path)
 *
 * Issue #65: Entry point of the committee assignment flow.
 * The Coordinator creates a new committee draft by providing a committee name
 * and optional description. The system validates uniqueness, stores the draft
 * in D3, and forwards the committee draft to process 4.2 for advisor assignment.
 *
 * Role guard: Coordinator only (403 for others — enforced on API + UI redirect)
 */
const CommitteeCreationForm = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // ── Form state ────────────────────────────────────────────────────────────
  const [committeeName, setCommitteeName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [createdCommittee, setCreatedCommittee] = useState(null);

  // ── Role guard (UI layer) ─────────────────────────────────────────────────
  if (!user || user.role !== 'coordinator') {
    return (
      <div className="committee-page">
        <div className="committee-card">
          <div className="committee-alert committee-alert--error">
            <span>🚫</span>
            <span>Access Denied — This page is restricted to Coordinators only.</span>
          </div>
          <div className="committee-form__actions" style={{ marginTop: '16px' }}>
            <button
              id="committee-go-back-btn"
              className="btn-cancel"
              onClick={() => navigate(-1)}
            >
              ← Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form submission ───────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!committeeName.trim()) {
      setError('Committee name is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createCommittee({
        committeeName: committeeName.trim(),
        coordinatorId: user.userId,
        description: description.trim() || undefined,
      });
      setCreatedCommittee(result);
    } catch (err) {
      console.error('Committee creation failed:', err);
      const status = err.response?.status;
      const msg = err.response?.data?.message;

      if (status === 409) {
        setError(msg || `A committee named "${committeeName.trim()}" already exists.`);
      } else if (status === 403) {
        setError('You do not have permission to create committees.');
      } else if (status === 400) {
        setError(msg || 'Please fill in all required fields.');
      } else {
        setError(msg || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Success state ─────────────────────────────────────────────────────────
  if (createdCommittee) {
    return (
      <div className="committee-page">
        <div className="committee-card">
          <div className="committee-success">
            <div className="committee-success__icon">✓</div>
            <h2 className="committee-success__title">Committee Created!</h2>
            <p className="committee-success__body">
              <strong>{createdCommittee.committeeName}</strong> has been saved as a draft
              and forwarded to Process 4.2 for advisor assignment.
            </p>
            <div className="committee-success__id">
              <span>🆔</span>
              <span>{createdCommittee.committeeId}</span>
            </div>
            <p className="committee-success__hint">
              Status: <strong style={{ color: '#a5b4fc' }}>draft</strong> ·
              Process 4.2 will handle advisor assignment next.
            </p>

            <div className="committee-form__actions" style={{ justifyContent: 'center', marginTop: '8px' }}>
              <button
                id="committee-create-another-btn"
                className="btn-cancel"
                onClick={() => {
                  setCreatedCommittee(null);
                  setCommitteeName('');
                  setDescription('');
                }}
              >
                Create Another
              </button>
              <button
                id="committee-go-coordinator-btn"
                className="btn-create"
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
    <div className="committee-page">
      <div className="committee-card">
        {/* Back button */}
        <button
          id="committee-back-btn"
          className="committee-back"
          onClick={() => navigate('/coordinator')}
        >
          ← Coordinator Panel
        </button>

        {/* Header */}
        <div className="committee-card__header">
          <div className="committee-card__icon">🏛</div>
          <div className="committee-card__badge">
            <span>⚙</span> Process 4.1 — Create Committee
          </div>
          <h1 className="committee-card__title">New Committee</h1>
          <p className="committee-card__subtitle">
            Create a committee draft. After creation, the draft will be automatically
            forwarded to Process 4.2 for advisor assignment.
          </p>
        </div>

        <hr className="committee-divider" />

        {/* Error alert */}
        {error && (
          <div
            id="committee-error-alert"
            className="committee-alert committee-alert--error"
            style={{ marginBottom: '20px' }}
          >
            <span>⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form
          id="committee-creation-form"
          className="committee-form"
          onSubmit={handleSubmit}
          noValidate
        >
          {/* Committee Name */}
          <div className="committee-form__group">
            <label htmlFor="committee-name" className="committee-form__label">
              Committee Name <span className="required">*</span>
            </label>
            <input
              id="committee-name"
              type="text"
              className="committee-form__input"
              placeholder="e.g. Spring 2026 Thesis Committee"
              value={committeeName}
              onChange={(e) => {
                setCommitteeName(e.target.value);
                if (error) setError(null);
              }}
              disabled={isSubmitting}
              maxLength={120}
              autoFocus
              required
            />
            <p className="committee-form__hint">
              Must be unique across all committees. Max 120 characters.
            </p>
          </div>

          {/* Description (optional) */}
          <div className="committee-form__group">
            <label htmlFor="committee-description" className="committee-form__label">
              Description <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>(optional)</span>
            </label>
            <textarea
              id="committee-description"
              className="committee-form__textarea"
              placeholder="Provide context about this committee's purpose, scope, or timeline…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              rows={4}
              maxLength={500}
            />
            <p className="committee-form__hint">
              {description.length}/500 characters
            </p>
          </div>

          {/* Info box */}
          <div className="committee-info-box">
            <span className="committee-info-box__icon">ℹ</span>
            <p className="committee-info-box__text">
              The committee will be created with status <strong style={{ color: '#a5b4fc' }}>draft</strong> and
              empty advisor / jury lists. It will be forwarded to Process 4.2 immediately
              after creation for advisor assignment.
            </p>
          </div>

          {/* Actions */}
          <div className="committee-form__actions">
            <button
              id="committee-cancel-btn"
              type="button"
              className="btn-cancel"
              onClick={() => navigate('/coordinator')}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              id="committee-submit-btn"
              type="submit"
              className="btn-create"
              disabled={isSubmitting || !committeeName.trim()}
            >
              {isSubmitting ? (
                <>
                  <span className="committee-spinner" />
                  Creating…
                </>
              ) : (
                '🏛 Create Committee'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CommitteeCreationForm;
