import React from 'react';
import DeliverableSubmissionForm from '../components/deliverables/DeliverableSubmissionForm';
import FileUploadWidget from '../components/deliverables/FileUploadWidget';
import '../components/PageShell.css';

/**
 * Page wrapper for the deliverable submission process.
 * Lives at /dashboard/submit-deliverable
 */
const SubmitDeliverablePage = () => {
  return (
    <div className="student-page-shell narrow">
      <header className="student-page-header">
        <div>
          <p className="student-page-kicker">Deliverables</p>
          <h1>Submit Deliverable</h1>
          <p>Validate your group and upload the required project artifact.</p>
        </div>
      </header>
      <DeliverableSubmissionForm FileUploadWidget={FileUploadWidget} />
    </div>
  );
};

export default SubmitDeliverablePage;
