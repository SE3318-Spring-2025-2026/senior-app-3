import React from 'react';

const readableDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleString();
};

const CommitteeStatusCard = ({ committeeStatus, user }) => {
  const committee = committeeStatus?.committee || null;
  const isPublished = committee?.status === 'published';
  const isAdvisor = committee?.advisorIds?.includes(user?.userId);

  return (
    <div className="committee-status-card status-card">
      <div className="card-header">
        <h3 className="card-title">Committee Status</h3>
        <span className={`status-badge ${isPublished ? 'connected' : 'disconnected'}`}>
          {isPublished ? 'Published' : 'Not Published'}
        </span>
      </div>
      <div className="card-content">
        {!committeeStatus?.committeeId && (
          <div className="empty-state">
            <p>Committee not yet published.</p>
            <p>When published, the committee name, advisors, and jury members will appear here.</p>
          </div>
        )}

        {committee && !isPublished && (
          <div className="committee-preview">
            <p className="info-label">Committee draft:</p>
            <p className="info-value">{committee.committeeName}</p>
            <p className="card-hint">This committee has not yet reached published status.</p>
          </div>
        )}

        {committee && (
          <div className="committee-details">
            <div className="info-row">
              <span className="info-label">Name</span>
              <span className="info-value">{committee.committeeName}</span>
            </div>
            {committee.description && (
              <div className="info-row">
                <span className="info-label">Description</span>
                <span className="info-value">{committee.description}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Published At</span>
              <span className="info-value">{readableDate(committee.publishedAt)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Advisors</span>
              <span className="info-value">
                {committee.advisorIds.length > 0 ? committee.advisorIds.join(', ') : 'None assigned'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Jury</span>
              <span className="info-value">
                {committee.juryIds.length > 0 ? committee.juryIds.join(', ') : 'None assigned'}
              </span>
            </div>
            {isAdvisor && (
              <p className="card-hint">You are assigned to this committee as an advisor.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommitteeStatusCard;
