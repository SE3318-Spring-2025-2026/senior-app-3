import React from 'react';

const StudentCommitteeStatus = ({ committee }) => {
  const isPublished = committee?.status === 'published';

  if (!committee || !isPublished) {
    return (
      <section className="student-committee-status" data-testid="student-committee-placeholder">
        <h2>Committee Status</h2>
        <div className="placeholder">Committee not yet published.</div>
      </section>
    );
  }

  return (
    <section className="student-committee-status" data-testid="student-committee-card">
      <h2>Published Committee</h2>
      <div className="committee-card">
        <p data-testid="committee-name"><strong>{committee.committeeName}</strong></p>
        <p data-testid="committee-published-at">Published at: {committee.publishedAt}</p>
        <div className="committee-members">
          <div>
            <h3>Advisors</h3>
            <ul data-testid="advisor-list">
              {committee.advisorIds?.map((advisorId) => (
                <li key={advisorId}>{advisorId}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Jury</h3>
            <ul data-testid="jury-list">
              {committee.juryIds?.map((juryId) => (
                <li key={juryId}>{juryId}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StudentCommitteeStatus;
