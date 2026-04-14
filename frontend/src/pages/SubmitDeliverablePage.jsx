import React from 'react';
import DeliverableSubmissionForm from '../components/deliverables/DeliverableSubmissionForm';
import FileUploadWidget from '../components/deliverables/FileUploadWidget';

/**
 * Page wrapper for the deliverable submission process.
 * Lives at /dashboard/submit-deliverable
 */
const SubmitDeliverablePage = () => {
  return (
    <div className="page p-8">
      <div className="max-w-4xl mx-auto">
        <DeliverableSubmissionForm FileUploadWidget={FileUploadWidget} />
      </div>
    </div>
  );
};

export default SubmitDeliverablePage;
