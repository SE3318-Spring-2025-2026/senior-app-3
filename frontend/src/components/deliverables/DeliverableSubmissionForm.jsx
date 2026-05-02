import React, { useState, useEffect, useRef } from 'react';
import useAuthStore from '../../store/authStore';
import { validateGroupForSubmission, getGroupSprints } from '../../api/deliverableService';
import { normalizeGroupId } from '../../utils/groupId';

/**
 * DeliverableSubmissionForm Component
 */
const DeliverableSubmissionForm = ({ FileUploadWidget }) => {
  const user = useAuthStore((state) => state.user);
  const groupId = normalizeGroupId(user?.groupId);

  // Form inputs
  const [deliverableType, setDeliverableType] = useState('');
  const [selectedSprints, setSelectedSprints] = useState([]);
  const [description, setDescription] = useState('');

  // Sprint dropdown data
  const [availableSprints, setAvailableSprints] = useState([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsError, setSprintsError] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Form state management
  const [formState, setFormState] = useState('initial'); // initial, loading, token_received, error
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [validationToken, setValidationToken] = useState(null);
  const [lockedReason, setLockedReason] = useState('');
  const devBypass = localStorage.getItem('DEV_BYPASS') === 'true';

  // Field-level error tracking
  const [fieldErrors, setFieldErrors] = useState({});

  // Fetch available sprints for this group on mount
  useEffect(() => {
    if (!groupId) return;
    setSprintsLoading(true);
    setSprintsError(null);
    getGroupSprints(groupId)
      .then(({ sprints }) => setAvailableSprints(sprints || []))
      .catch(() => setSprintsError('Failed to load sprints'))
      .finally(() => setSprintsLoading(false));
  }, [groupId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSprintToggle = (sprintId) => {
    setSelectedSprints((prev) =>
      prev.includes(sprintId) ? prev.filter((s) => s !== sprintId) : [...prev, sprintId]
    );
  };

  /**
   * Determine if submit button should be disabled
   */
  const isSubmitDisabled =
    !deliverableType ||
    selectedSprints.length === 0 ||
    (Boolean(lockedReason) && !devBypass) ||
    formState === 'loading' ||
    formState === 'token_received';

  /**
   * Handle form submission
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setLockedReason('');
    setFieldErrors({});

    // Validate required fields
    const errors = {};
    if (!deliverableType) errors.deliverableType = 'Deliverable type is required';
    if (selectedSprints.length === 0) errors.sprintId = 'At least one sprint is required';
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
      if (status === 404) {
        const backendMessage = (data?.message || '').toLowerCase();
        if (backendMessage.includes('committee')) {
          if (devBypass) {
            msg = 'Committee is missing, but DEV_BYPASS is enabled so submission flow remains testable.';
            setErrorCode('NO_COMMITTEE_BYPASSED');
          } else {
            msg = 'Awaiting Committee Assignment';
            setLockedReason('Awaiting Committee Assignment');
            setErrorCode('NO_COMMITTEE');
          }
        } else {
          msg = data?.message || 'Group Not Found';
        }
      }
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

  // Compute sprint trigger button label
  let triggerLabel = 'Select sprint(s)...';
  if (sprintsLoading) triggerLabel = 'Loading sprints...';
  else if (sprintsError) triggerLabel = 'Failed to load sprints';
  else if (availableSprints.length === 0) triggerLabel = 'No sprints available';
  else if (selectedSprints.length === 1) triggerLabel = selectedSprints[0];
  else if (selectedSprints.length > 1) triggerLabel = `${selectedSprints.length} sprints selected`;
  const triggerIsPlaceholder = selectedSprints.length === 0;

  if (formState === 'token_received' && FileUploadWidget && validationToken) {
    return (
      <div className="w-full">
        <FileUploadWidget
          validationToken={validationToken}
          groupId={groupId}
          deliverableType={deliverableType}
          sprintIds={selectedSprints}
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
        {devBypass && (
          <div className="mb-6 p-4 rounded-2xl border border-blue-100 bg-blue-50 text-blue-800">
            <p className="text-sm font-bold">Dev Bypass Enabled</p>
            <p className="text-sm">Frontend lock checks are bypassed (`DEV_BYPASS=true`).</p>
          </div>
        )}
        {lockedReason && (
          <div className="mb-6 p-4 rounded-2xl border border-amber-100 bg-amber-50 text-amber-800">
            <p className="text-sm font-bold">Submission Locked</p>
            <p className="text-sm">{lockedReason}</p>
          </div>
        )}

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

          {/* SPRINT(S) */}
          <div className="gap-2 flex flex-col items-start">
            <span className="text-start mb-[6px] font-semibold text-[#333] text-sm">
              SPRINT(S) <span className="text-red-500">*</span>
            </span>

            <div className="w-full relative" ref={dropdownRef}>
              {/* Trigger button */}
              <button
                type="button"
                onClick={() => setDropdownOpen((prev) => !prev)}
                disabled={sprintsLoading || !!sprintsError || availableSprints.length === 0}
                className={`w-full px-[14px] py-[11px] border-2 rounded-md text-[0.95rem] font-medium transition-colors duration-200 focus:outline-none text-left flex items-center justify-between
                  ${fieldErrors.sprintId
                    ? 'border-[#e74c3c] focus:ring-4 focus:ring-[rgba(231,76,60,0.1)]'
                    : 'border-[#e0e0e0] focus:border-[#667eea] focus:ring-4 focus:ring-[rgba(102,126,234,0.12)]'}
                  ${(sprintsLoading || !!sprintsError || availableSprints.length === 0) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={triggerIsPlaceholder ? 'text-slate-400' : 'text-slate-700'}>
                  {triggerLabel}
                </span>
                <svg
                  className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown panel */}
              {dropdownOpen && availableSprints.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border-2 border-[#e0e0e0] rounded-md shadow-lg overflow-hidden">
                  {availableSprints.map((sprint) => (
                    <label
                      key={sprint.sprintId}
                      className="flex items-center gap-3 px-4 py-[10px] cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSprints.includes(sprint.sprintId)}
                        onChange={() => handleSprintToggle(sprint.sprintId)}
                        className="w-4 h-4 accent-[#667eea]"
                      />
                      <span className="text-[0.95rem] font-medium text-slate-700">
                        {sprint.sprintId}
                      </span>
                      <span className="ml-auto text-xs text-slate-400 uppercase tracking-wider">
                        {sprint.status}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {fieldErrors.sprintId && (
              <p className="text-xs text-red-500 font-bold">{fieldErrors.sprintId}</p>
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
