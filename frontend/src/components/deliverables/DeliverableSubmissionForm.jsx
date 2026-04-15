import React, { useState } from 'react';
import useAuthStore from '../../store/authStore';
import { validateGroupForSubmission } from '../../api/deliverableService';

/**
 * DeliverableSubmissionForm Component
 */
const DeliverableSubmissionForm = ({ FileUploadWidget }) => {
  const user = useAuthStore((state) => state.user);
  const groupId = user?.groupId;

  console.log(user)

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
      <div className="w-full">
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
    <div className="w-full max-w-xl mx-auto">
      <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Initiate Submission</h2>
        <p className="text-slate-500 mb-8 text-sm">Select the deliverable type and provide sprint details to proceed.</p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
            <div className="text-red-500 mt-0.5">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-800">{error}</p>
              {errorCode === 'NETWORK_ERROR' && (
                <button
                  onClick={handleRetry}
                  className="mt-2 text-xs font-bold text-red-600 underline"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 text-gray-800">

          {/* DELIVERABLE TYPE */}
          <div className="gap-2 flex flex-col items-start">
            <label
              htmlFor="deliverable-type"
              className="text-start mb-[6px] font-semibold text-[#333] text-sm"
            >
              DELIVERABLE TYPE <span className="text-red-500">*</span>
            </label>

            <select
              id="deliverable-type"
              value={deliverableType}
              onChange={(e) => setDeliverableType(e.target.value)}
              className={`w-full px-[14px] py-[11px] border-2 rounded-md text-[0.95rem] font-medium transition-colors duration-200 focus:outline-none
      ${fieldErrors.deliverableType
                  ? "border-[#e74c3c] focus:ring-4 focus:ring-[rgba(231,76,60,0.1)]"
                  : "border-[#e0e0e0] focus:border-[#667eea] focus:ring-4 focus:ring-[rgba(102,126,234,0.12)]"
                }`}
            >
              <option value="">Select a type...</option>
              <option value="proposal">Proposal</option>
              <option value="statement_of_work">Statement of Work</option>
              <option value="demo">Demo</option>
              <option value="interim_report">Interim Report</option>
              <option value="final_report">Final Report</option>
            </select>

            {fieldErrors.deliverableType && (
              <p className="text-xs text-red-500 font-bold">
                {fieldErrors.deliverableType}
              </p>
            )}
          </div>

          {/* SPRINT ID */}
          <div className="gap-2 flex flex-col items-start">
            <label
              htmlFor="sprint-id"
              className="text-start mb-[6px] font-semibold text-[#333] text-sm"
            >
              SPRINT ID <span className="text-red-500">*</span>
            </label>

            <input
              id="sprint-id"
              type="text"
              value={sprintId}
              onChange={(e) => setSprintId(e.target.value)}
              placeholder="e.g. Sprint-01"
              className={`w-full px-[14px] py-[11px] border-2 rounded-md text-[0.95rem] font-medium transition-colors duration-200 focus:outline-none
      ${fieldErrors.sprintId
                  ? "border-[#e74c3c] focus:ring-4 focus:ring-[rgba(231,76,60,0.1)]"
                  : "border-[#e0e0e0] focus:border-[#667eea] focus:ring-4 focus:ring-[rgba(102,126,234,0.12)]"
                }`}
            />

            {fieldErrors.sprintId && (
              <p className="text-xs text-red-500 font-bold">
                {fieldErrors.sprintId}
              </p>
            )}
          </div>

          {/* DESCRIPTION */}
          <div className="gap-2 flex flex-col items-start">
            <label
              htmlFor="description"
              className="text-start mb-[6px] font-semibold text-[#333] text-sm"
            >
              DESCRIPTION <span className="text-slate-300">(Optional)</span>
            </label>

            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="10-500 characters..."
              className={`w-full px-[14px] py-[11px] border-2 rounded-md text-[0.95rem] transition-colors duration-200 focus:outline-none min-h-[120px]
      ${fieldErrors.description
                  ? "border-[#e74c3c] focus:ring-4 focus:ring-[rgba(231,76,60,0.1)]"
                  : "border-[#e0e0e0] focus:border-[#667eea] focus:ring-4 focus:ring-[rgba(102,126,234,0.12)]"
                }`}
            />

            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
              {fieldErrors.description ? (
                <span className="text-red-500">{fieldErrors.description}</span>
              ) : (
                <span className="text-slate-400">Contextual notes</span>
              )}
              <span
                className={
                  description.length > 500 ? "text-red-500" : "text-slate-400"
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
            className={`${isSubmitDisabled ? "opacity-50 cursor-not-allowed" : "opacity-100 cursor-pointer"} w-full p-[13px] bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-md text-base font-semibold transition-opacity duration-200 mt-2`}
          >
            {formState === "loading"
              ? "Validating..."
              : "Continue to File Upload"}
          </button>

        </form>
      </div>
    </div>
  );
};

export default DeliverableSubmissionForm;
