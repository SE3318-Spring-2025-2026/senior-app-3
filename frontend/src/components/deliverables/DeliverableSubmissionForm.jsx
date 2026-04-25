import React, { useState } from 'react';
import useAuthStore from '../../store/authStore';
import { validateGroupForSubmission } from '../../api/deliverableService';
import '../PageShell.css';

/**
 * DeliverableSubmissionForm Component
 */
const DeliverableSubmissionForm = ({ FileUploadWidget }) => {
  const user = useAuthStore((state) => state.user);
  const groupId = user?.groupId;

  // Form inputs
  const [deliverableType, setDeliverableType] = useState('');
  const [sprintId, setSprintId] = useState('');
  const [description, setDescription] = useState('');

  // Form state management
  const [formState, setFormState] = useState('initial'); // initial, loading, token_received, error
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [validationToken, setValidationToken] = useState(null);

  // Field-level error tracking
  const [fieldErrors, setFieldErrors] = useState({});

  /**
   * Determine if submit button should be disabled
   */
  const isSubmitDisabled =
    !deliverableType ||
    !sprintId ||
    formState === 'loading' ||
    formState === 'token_received';

  /**
   * Handle form submission
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setFieldErrors({});

    // Validate required fields
    const errors = {};
    if (!deliverableType) errors.deliverableType = 'Deliverable type is required';
    if (!sprintId) errors.sprintId = 'Sprint ID is required';
    if (description && (description.length < 10 || description.length > 500)) {
      errors.description = 'Description must be between 10 and 500 characters';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (!groupId) {
      setError('Your account is not associated with any group.');
      setFormState('error');
      setErrorCode('NO_GROUP');
      return;
    }

    setFormState('loading');

    try {
      const response = await validateGroupForSubmission(groupId);
      setValidationToken(response.validationToken);
      setFormState('token_received');
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;

      let msg = 'An error occurred during validation';
      if (status === 403) msg = data?.message || 'Access Forbidden';
      if (status === 404) msg = data?.message || 'Group Not Found';
      if (status === 409) msg = data?.message || 'Conflict detected';
      if (err.code === 'ERR_NETWORK') msg = 'Network error. Please try again.';

      setError(msg);
      setErrorCode(status || 'NETWORK_ERROR');
      setFormState('error');
    }
  };

  const handleRetry = () => {
    setFormState('initial');
    setError(null);
  };

  if (formState === 'token_received' && FileUploadWidget && validationToken) {
    return (
      <div className="deliverable-upload-stage">
        <FileUploadWidget
          validationToken={validationToken}
          groupId={groupId}
          deliverableType={deliverableType}
          sprintId={sprintId}
          description={description}
        />
      </div>
    );
  }

  return (
    <div className="student-card">
      <div className="student-card-header">
        <h2>Initiate Submission</h2>
        <p>Select the deliverable type and provide sprint details to proceed.</p>
      </div>

        {error && (
          <div className="student-alert error">
            <strong>{error}</strong>
              {errorCode === 'NETWORK_ERROR' && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-reset-button"
                >
                  Try Again
                </button>
              )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="student-form">

          {/* DELIVERABLE TYPE */}
          <div className="student-form-group">
            <label htmlFor="deliverable-type">
              DELIVERABLE TYPE <span className="required">*</span>
            </label>

            <select
              id="deliverable-type"
              value={deliverableType}
              onChange={(e) => setDeliverableType(e.target.value)}
              className={`student-select ${fieldErrors.deliverableType ? 'error' : ''}`}
            >
              <option value="">Select a type...</option>
              <option value="proposal">Proposal</option>
              <option value="statement_of_work">Statement of Work</option>
              <option value="demo">Demo</option>
              <option value="interim_report">Interim Report</option>
              <option value="final_report">Final Report</option>
            </select>

            {fieldErrors.deliverableType && (
              <p className="field-error">
                {fieldErrors.deliverableType}
              </p>
            )}
          </div>

          {/* SPRINT ID */}
          <div className="student-form-group">
            <label htmlFor="sprint-id">
              SPRINT ID <span className="required">*</span>
            </label>

            <input
              id="sprint-id"
              type="text"
              value={sprintId}
              onChange={(e) => setSprintId(e.target.value)}
              placeholder="e.g. Sprint-01"
              className={`student-input ${fieldErrors.sprintId ? 'error' : ''}`}
            />

            {fieldErrors.sprintId && (
              <p className="field-error">
                {fieldErrors.sprintId}
              </p>
            )}
          </div>

          {/* DESCRIPTION */}
          <div className="student-form-group">
            <label htmlFor="description">
              DESCRIPTION <span className="optional">(Optional)</span>
            </label>

            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="10-500 characters..."
              className={`student-textarea ${fieldErrors.description ? 'error' : ''}`}
            />

            <div className="field-meta-row">
              {fieldErrors.description ? (
                <span className="field-error">{fieldErrors.description}</span>
              ) : (
                <span>Contextual notes</span>
              )}
              <span
                className={
                  description.length > 500 ? 'field-error' : ''
                }
              >
                {description.length}/500
              </span>
            </div>
          </div>

          {/* BUTTON */}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="student-btn primary full-width"
          >
            {formState === "loading"
              ? "Validating..."
              : "Continue to File Upload"}
          </button>

        </form>
    </div>
  );
};

export default DeliverableSubmissionForm;
