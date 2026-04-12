import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { createCommittee } from '../api/committeeService';
import './CommitteeCreationForm.css';

/**
 * Process 4.1 — Create committee draft (coordinator).
 * POST /api/v1/committees
 */
const CommitteeCreationForm = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [committeeName, setCommitteeName] = useState('');
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [nameError, setNameError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setNameError('');

    const name = committeeName.trim();
    if (!name) {
      setNameError('Committee name is required.');
      return;
    }

    if (!user?.userId) {
      setSubmitError('You must be signed in as a coordinator.');
      return;
    }

    setLoading(true);
    try {
      await createCommittee({
        committeeName: name,
        coordinatorId: user.userId,
        description: description.trim() || undefined,
      });
      navigate('/coordinator');
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'DUPLICATE_COMMITTEE_NAME' || data?.code === 'INVALID_INPUT') {
        setNameError(data?.message || 'A committee with this name already exists.');
      } else {
        setSubmitError(data?.message || 'Failed to create committee.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="committee-creation-page">
      <div className="committee-creation-card">
        <h1 className="committee-creation-title">New committee</h1>
        <p className="committee-creation-subtitle">
          Process 4.1 — Create a draft. Assign advisors (4.2) and jury (4.3) from the coordinator panel.
        </p>

        {submitError && <div className="committee-creation-alert error">{submitError}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <label className="committee-creation-label" htmlFor="committeeName">
            Committee name <span className="required">*</span>
          </label>
          <input
            id="committeeName"
            name="committeeName"
            type="text"
            className="committee-creation-input"
            value={committeeName}
            onChange={(e) => setCommitteeName(e.target.value)}
            disabled={loading}
            autoComplete="off"
            maxLength={200}
          />
          {nameError && <p className="committee-creation-field-error">{nameError}</p>}

          <label className="committee-creation-label" htmlFor="description">
            Description <span className="optional">(optional)</span>
          </label>
          <textarea
            id="description"
            name="description"
            className="committee-creation-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={loading}
            rows={4}
            maxLength={2000}
          />

          <div className="committee-creation-actions">
            <button type="button" className="btn-secondary" onClick={() => navigate('/coordinator')} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CommitteeCreationForm;
