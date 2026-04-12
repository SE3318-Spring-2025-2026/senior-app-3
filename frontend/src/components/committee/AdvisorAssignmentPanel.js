import React, { useState } from 'react';
import { assignAdvisors } from '../../api/committeeService';

const AdvisorAssignmentPanel = ({ committeeId, availableAdvisors = [], onAssignSuccess }) => {
  const [selectedAdvisorIds, setSelectedAdvisorIds] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleAdvisor = (advisorId) => {
    setSelectedAdvisorIds((prev) =>
      prev.includes(advisorId) ? prev.filter((id) => id !== advisorId) : [...prev, advisorId]
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
    if (selectedAdvisorIds.length === 0) {
      setError('Please select at least one advisor.');
      return;
    }

    setLoading(true);
    try {
      await assignAdvisors(committeeId, selectedAdvisorIds);
      setSuccess('Advisors assigned successfully.');
      setSelectedAdvisorIds([]);
      if (onAssignSuccess) onAssignSuccess(selectedAdvisorIds);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to assign advisors.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="advisor-assignment-panel" data-testid="advisor-assignment-panel">
      <h2>Assign Advisors</h2>
      {availableAdvisors.length === 0 ? (
        <p data-testid="advisor-empty-state">No advisors available.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset>
            <legend>Select advisors</legend>
            {availableAdvisors.map((advisor) => (
              <label key={advisor.id} className="checkbox-option">
                <input
                  type="checkbox"
                  value={advisor.id}
                  checked={selectedAdvisorIds.includes(advisor.id)}
                  onChange={() => toggleAdvisor(advisor.id)}
                  data-testid={`advisor-checkbox-${advisor.id}`}
                />
                {advisor.name}
              </label>
            ))}
          </fieldset>

          {error && <div className="error-message" data-testid="advisor-error">{error}</div>}
          {success && <div className="success-message" data-testid="advisor-success">{success}</div>}

          <button type="submit" disabled={loading} data-testid="advisor-submit-btn">
            {loading ? 'Assigning…' : 'Assign Advisors'}
          </button>
        </form>
      )}
    </section>
  );
};

export default AdvisorAssignmentPanel;
