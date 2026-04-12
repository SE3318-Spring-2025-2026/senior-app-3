import React, { useState } from 'react';
import { assignJury } from '../../api/committeeService';

const JuryAssignmentPanel = ({ committeeId, availableJury = [], onAssignSuccess }) => {
  const [selectedJuryIds, setSelectedJuryIds] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleJury = (juryId) => {
    setSelectedJuryIds((prev) =>
      prev.includes(juryId) ? prev.filter((id) => id !== juryId) : [...prev, juryId]
    );
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!committeeId) {
      setError('No committee selected.');
      return;
    }
    if (selectedJuryIds.length === 0) {
      setError('Please select at least one jury member.');
      return;
    }

    setLoading(true);
    try {
      await assignJury(committeeId, selectedJuryIds);
      setSuccess('Jury members assigned successfully.');
      setSelectedJuryIds([]);
      if (onAssignSuccess) onAssignSuccess(selectedJuryIds);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to assign jury members.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="jury-assignment-panel" data-testid="jury-assignment-panel">
      <h2>Assign Jury</h2>
      {availableJury.length === 0 ? (
        <p data-testid="jury-empty-state">No jury members available.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset>
            <legend>Select jury members</legend>
            {availableJury.map((jury) => (
              <label key={jury.id} className="checkbox-option">
                <input
                  type="checkbox"
                  value={jury.id}
                  checked={selectedJuryIds.includes(jury.id)}
                  onChange={() => toggleJury(jury.id)}
                  data-testid={`jury-checkbox-${jury.id}`}
                />
                {jury.name}
              </label>
            ))}
          </fieldset>

          {error && <div className="error-message" data-testid="jury-error">{error}</div>}
          {success && <div className="success-message" data-testid="jury-success">{success}</div>}

          <button type="submit" disabled={loading} data-testid="jury-submit-btn">
            {loading ? 'Assigning…' : 'Assign Jury'}
          </button>
        </form>
      )}
    </section>
  );
};

export default JuryAssignmentPanel;
