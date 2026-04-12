import React, { useState } from 'react';
import { submitDeliverable } from '../../api/deliverableService';

const DELIVERABLE_TYPES = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'statement-of-work', label: 'Statement of Work' },
  { value: 'demonstration', label: 'Demonstration' },
];

const DeliverableSubmissionForm = ({ committee, groupId, scheduleOpen = true }) => {
  const [type, setType] = useState('proposal');
  const [storageRef, setStorageRef] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  const isPublished = committee?.status === 'published';
  const locked = !isPublished || !scheduleOpen;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess(null);

    if (locked) {
      setError('Deliverable submission is not available yet.');
      return;
    }
    if (!storageRef.trim()) {
      setError('Please provide a deliverable file URL or storage reference.');
      return;
    }

    setLoading(true);
    try {
      const result = await submitDeliverable({
        committeeId: committee.committeeId,
        groupId,
        type,
        storageRef: storageRef.trim(),
      });
      setSuccess(result);
      setStorageRef('');
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Submission failed.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="deliverable-submission-form" data-testid="deliverable-submission-form">
      <h2>Submit Deliverable</h2>
      {locked ? (
        <div data-testid="deliverable-locked" className="locked-message">
          {isPublished ? 'Deliverable submission is closed by schedule.' : 'Committee not yet published.'}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="deliverableType">Deliverable Type</label>
            <select
              id="deliverableType"
              value={type}
              onChange={(e) => setType(e.target.value)}
              data-testid="deliverable-type-selector"
            >
              {DELIVERABLE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="storageRef">File URL or Storage Reference</label>
            <input
              id="storageRef"
              type="text"
              value={storageRef}
              onChange={(e) => setStorageRef(e.target.value)}
              placeholder="https://... or storage reference"
              data-testid="deliverable-storage-ref"
            />
          </div>

          {error && <div className="error-message" data-testid="deliverable-error">{error}</div>}
          {success && (
            <div className="confirmation-card" data-testid="deliverable-success-card">
              <p>Submission successful!</p>
              <p>Deliverable ID: {success.deliverableId}</p>
              <p>Submitted at: {success.submittedAt}</p>
              <p>Storage ref: {success.storageRef}</p>
            </div>
          )}

          <button type="submit" disabled={loading} data-testid="deliverable-submit-btn">
            {loading ? 'Submitting…' : 'Submit Deliverable'}
          </button>
        </form>
      )}
    </section>
  );
};

export default DeliverableSubmissionForm;
