import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { validateGroupForSubmission } from '../api/deliverableService';

// Deliverable type options matching the enum from backend
const DELIVERABLE_TYPES = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'statement_of_work', label: 'Statement of Work' },
  { value: 'demo', label: 'Demo' },
  { value: 'interim_report', label: 'Interim Report' },
  { value: 'final_report', label: 'Final Report' },
];

/**
 * DeliverableSubmissionForm Component — Process 5.1
 */
const DeliverableSubmissionForm = ({ groupId: groupIdProp, onValidationSuccess, FileUploadWidget }) => {
  const { group_id } = useParams();
  const groupId = groupIdProp || group_id;

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
   * Validate description length (10-500 chars if provided)
   */
  const validateDescription = (desc) => {
    if (!desc) return true; // optional field
    return desc.length >= 10 && desc.length <= 500;
  };

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
    if (!deliverableType) {
      errors.deliverableType = 'Deliverable type is required';
    }
    if (!sprintId) {
      errors.sprintId = 'Sprint ID is required';
    }
    if (description && !validateDescription(description)) {
      errors.description = 'Description must be between 10 and 500 characters';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (!groupId) {
      setError('Unable to determine your group. Please ensure you are logged in.');
      setErrorCode('NO_GROUP');
      setFormState('error');
      return;
    }

    setFormState('loading');

    try {
      // Call validation endpoint
      const response = await validateGroupForSubmission(groupId);

      // On success: store token and move to token_received state
      setValidationToken(response.validationToken);
      setFormState('token_received');

      // Call optional callback
      if (onValidationSuccess) {
        onValidationSuccess({
          validationToken: response.validationToken,
          deliverableType,
          sprintId,
          description,
        });
      }
    } catch (err) {
      const data = err.response?.data;
      const status = err.response?.status;

      let errorMessage = 'An error occurred during validation';

      // Map specific error codes to user-friendly messages
      if (status === 403) {
        errorMessage =
          data?.message ||
          'Your group does not have permission to submit deliverables. Contact your advisor.';
        setErrorCode('FORBIDDEN');
      } else if (status === 404) {
        errorMessage =
          data?.message ||
          'Your group was not found. Please check your account status.';
        setErrorCode('NOT_FOUND');
      } else if (status === 409) {
        errorMessage =
          data?.message ||
          'A conflict occurred. You may have already submitted this deliverable type.';
        setErrorCode('CONFLICT');
      } else if (err.code === 'ERR_NETWORK') {
        errorMessage = 'Network error. Please check your connection and try again.';
        setErrorCode('NETWORK_ERROR');
      } else {
        errorMessage = data?.message || err.message || 'Unknown error occurred';
        setErrorCode('UNKNOWN');
      }

      setError(errorMessage);
      setFormState('error');
    }
  };

  /**
   * Handle retry after error
   */
  const handleRetry = () => {
    setFormState('initial');
    setError(null);
    setErrorCode(null);
  };

  /**
   * Handle cancel/reset from token_received state
   */
  const handleCancel = () => {
    setFormState('initial');
    setValidationToken(null);
    setDeliverableType('');
    setSprintId('');
    setDescription('');
    setError(null);
    setErrorCode(null);
  };

  // If token was received and FileUploadWidget is provided, render widget
  if (formState === 'token_received' && FileUploadWidget && validationToken) {
    return (
      <div className="w-full max-w-2xl mx-auto py-8">
        <FileUploadWidget
          validationToken={validationToken}
          deliverableType={deliverableType}
          sprintId={sprintId}
          description={description}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto py-8">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-50 bg-gray-50/50">
          <h2 className="text-xl font-bold text-gray-900">Submit Deliverable</h2>
          <p className="text-sm text-gray-500 mt-1 font-medium">
            Fill in the details below to validate your group for submission.
          </p>
        </div>

        <div className="p-8">
          {/* Error Alert */}
          {error && (
            <div
              className={`mb-8 p-4 rounded-2xl border flex space-x-3 items-start ${errorCode === 'NETWORK_ERROR'
                  ? 'bg-yellow-50 border-yellow-100 text-yellow-800'
                  : 'bg-red-50 border-red-100 text-red-800'
                }`}
              role="alert"
            >
              <svg className="h-5 w-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <h3 className="font-extrabold text-sm mb-1 uppercase tracking-tight">
                  {errorCode === 'NETWORK_ERROR' ? 'Connection Error' : 'Validation Failed'}
                </h3>
                <p className="text-sm font-medium">{error}</p>
              </div>
              {errorCode === 'NETWORK_ERROR' && (
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 bg-yellow-600 text-white text-xs font-bold rounded-lg hover:bg-yellow-700 transition-all shadow-sm"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {/* Deliverable Type Field */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="deliverable-type"
                  className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2"
                >
                  Deliverable Type <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    id="deliverable-type"
                    name="deliverable-type"
                    value={deliverableType}
                    onChange={(e) => {
                      setDeliverableType(e.target.value);
                      if (fieldErrors.deliverableType) {
                        setFieldErrors((prev) => ({ ...prev, deliverableType: '' }));
                      }
                    }}
                    className={`w-full bg-gray-50 border rounded-xl px-5 py-3 text-sm font-bold appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_1.25rem_center] bg-no-repeat focus:outline-none focus:ring-2 transition-all ${fieldErrors.deliverableType
                        ? 'border-red-300 ring-red-500/10 focus:ring-red-500/20 focus:border-red-500'
                        : 'border-gray-100 ring-indigo-500/10 focus:ring-indigo-500/20 focus:border-indigo-500'
                      }`}
                  >
                    <option value="">Select type</option>
                    {DELIVERABLE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                {fieldErrors.deliverableType && (
                  <p className="mt-1.5 text-[10px] text-red-600 font-bold uppercase tracking-wider">{fieldErrors.deliverableType}</p>
                )}
              </div>

              {/* Sprint ID Field */}
              <div>
                <label htmlFor="sprint-id" className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                  Sprint / Phase ID <span className="text-red-500">*</span>
                </label>
                <input
                  id="sprint-id"
                  name="sprint-id"
                  type="text"
                  value={sprintId}
                  onChange={(e) => {
                    setSprintId(e.target.value);
                    if (fieldErrors.sprintId) {
                      setFieldErrors((prev) => ({ ...prev, sprintId: '' }));
                    }
                  }}
                  className={`w-full bg-gray-50 border rounded-xl px-5 py-3 text-sm font-bold focus:outline-none focus:ring-2 transition-all ${fieldErrors.sprintId
                      ? 'border-red-300 ring-red-500/10 focus:ring-red-500/20 focus:border-red-500'
                      : 'border-gray-100 ring-indigo-500/10 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  placeholder="e.g. Sprint-4"
                />
                {fieldErrors.sprintId && (
                  <p className="mt-1.5 text-[10px] text-red-600 font-bold uppercase tracking-wider">{fieldErrors.sprintId}</p>
                )}
              </div>
            </div>

            {/* Description Field */}
            <div>
              <label htmlFor="description" className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                Contextual Notes <span className="text-gray-300">(Optional)</span>
              </label>
              <textarea
                id="description"
                name="description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (fieldErrors.description) {
                    setFieldErrors((prev) => ({ ...prev, description: '' }));
                  }
                }}
                className={`w-full bg-gray-50 border rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-2 transition-all min-h-[120px] ${fieldErrors.description
                    ? 'border-red-300 ring-red-500/10 focus:ring-red-500/20 focus:border-red-500'
                    : 'border-gray-100 ring-indigo-500/10 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                placeholder="Add any specific context for the evaluators..."
                rows="4"
              />
              <div className="mt-2 flex justify-between items-center px-1">
                {fieldErrors.description ? (
                  <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider">{fieldErrors.description}</p>
                ) : (
                  <p className="text-[10px] text-gray-400 font-medium">10 - 500 characters</p>
                )}
                <p className={`text-[10px] font-bold ${description.length > 500 ? 'text-red-500' : 'text-gray-400'}`}>
                  {description.length} / 500
                </p>
              </div>
            </div>

            {/* Form Actions */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className={`w-full flex items-center justify-center space-x-3 py-4 px-6 font-extrabold rounded-2xl transition-all shadow-lg active:translate-y-0.5 ${isSubmitDisabled
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100'
                  }`}
              >
                {formState === 'loading' ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Validating Group...</span>
                  </>
                ) : (
                  <>
                    <span>Proceed to Upload</span>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </>
                )}
              </button>

              {formState === 'error' && errorCode !== 'NETWORK_ERROR' && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="w-full mt-3 py-3 text-gray-500 text-sm font-bold hover:text-gray-700 transition-colors"
                >
                  Clear & Reset Form
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default DeliverableSubmissionForm;
