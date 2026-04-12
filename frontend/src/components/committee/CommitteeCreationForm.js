import React, { useState } from 'react';
import useAuthStore from '../../store/authStore';
import { createCommittee } from '../../api/committeeService';

const CommitteeCreationForm = ({ onCreateSuccess }) => {
  const user = useAuthStore((state) => state.user);
  const [committeeName, setCommitteeName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!committeeName.trim()) {
      setError('Committee name is required.');
      return;
    }

    setLoading(true);
    try {
      const committee = await createCommittee({
        committeeName: committeeName.trim(),
        description: description.trim(),
        coordinatorId: user?.userId || '',
      });
      setSuccess('Committee created successfully.');
      setCommitteeName('');
      setDescription('');
      if (onCreateSuccess) onCreateSuccess(committee);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to create committee.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="committee-creation-form" data-testid="committee-creation-form">
      <h2>Create Committee</h2>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="committeeName">Committee Name</label>
          <input
            id="committeeName"
            type="text"
            value={committeeName}
            onChange={(e) => setCommitteeName(e.target.value)}
            placeholder="Enter committee name"
            data-testid="committee-name-input"
          />
        </div>

        <div className="form-group">
          <label htmlFor="committeeDescription">Description (optional)</label>
          <textarea
            id="committeeDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add an optional description"
            data-testid="committee-description-input"
          />
        </div>

        {error && <div className="error-message" data-testid="committee-error">{error}</div>}
        {success && <div className="success-message" data-testid="committee-success">{success}</div>}

        <button type="submit" disabled={loading} data-testid="committee-submit-btn">
          {loading ? 'Creating…' : 'Create Committee'}
        </button>
      </form>
    </section>
  );
};

export default CommitteeCreationForm;
