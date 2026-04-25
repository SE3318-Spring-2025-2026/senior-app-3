import React, { useEffect, useState } from 'react';
import { getJuryCommittees } from '../api/groupService';
import './GroupDashboard.css';

const readableDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString();
};

const JuryCommittees = () => {
  const [committees, setCommittees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadCommittees = async () => {
      try {
        const data = await getJuryCommittees();
        setCommittees(data.committees || []);
      } catch (err) {
        setError(err.message || 'Failed to load jury committees.');
      } finally {
        setIsLoading(false);
      }
    };

    loadCommittees();
  }, []);

  return (
    <div className="group-dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Jury Committees</h1>
          <p className="last-updated">View all committees where you are assigned as a jury member.</p>
        </div>
      </div>

      {error && (
        <div className="error-container">
          <div className="error-title">Error</div>
          <p className="error-message">{error}</p>
        </div>
      )}

      {isLoading && <div className="loading">Loading your assigned committees...</div>}

      {!isLoading && !error && committees.length === 0 && (
        <div className="empty-state">
          <p>You are not assigned to any jury committees yet.</p>
          <p>Once a committee assignment is published, it will appear here.</p>
        </div>
      )}

      <div className="dashboard-grid">
        {committees.map((committee) => (
          <div key={committee.committeeId} className="status-card">
            <div className="card-header">
              <h3 className="card-title">{committee.committeeName}</h3>
              <span className={`status-badge ${committee.status === 'published' ? 'connected' : 'disconnected'}`}>
                {committee.status}
              </span>
            </div>
            <div className="card-content">
              <div className="info-row">
                <span className="info-label">Committee ID</span>
                <span className="info-value">{committee.committeeId}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Published At</span>
                <span className="info-value">{readableDate(committee.publishedAt)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Advisors</span>
                <span className="info-value">
                  {committee.advisorIds.length > 0 ? committee.advisorIds.join(', ') : 'None'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Jury</span>
                <span className="info-value">{committee.juryIds.join(', ')}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Results</span>
                <a
                  className="info-value"
                  href={`/committees/${committee.committeeId}/final-results`}
                >
                  Final Results
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default JuryCommittees;
