import React from 'react';

const JuryCommitteePanel = ({ committees = [] }) => {
  if (!committees.length) {
    return (
      <section className="jury-committee-panel" data-testid="jury-empty-state">
        <h2>Your Assigned Committees</h2>
        <p>No committee assignments yet.</p>
      </section>
    );
  }

  return (
    <section className="jury-committee-panel" data-testid="jury-committees-list">
      <h2>Your Assigned Committees</h2>
      {committees.map((committee) => (
        <div key={committee.committeeId} className="committee-summary-card" data-testid="jury-committee-card">
          <p><strong>{committee.committeeName}</strong></p>
          <p>Status: {committee.status}</p>
          <p>Published at: {committee.publishedAt || 'Pending'}</p>
          <div>
            <h4>Advisors</h4>
            <ul>
              {committee.advisorIds?.map((advisorId) => (
                <li key={advisorId}>{advisorId}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Jury</h4>
            <ul>
              {committee.juryIds?.map((juryId) => (
                <li key={juryId}>{juryId}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </section>
  );
};

export default JuryCommitteePanel;
