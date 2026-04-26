import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  submitDeliverable,
  validateFormat,
  validateDeadline,
  storeDeliverable,
} from '../../api/deliverableAPI';

const FileUploadWidget = ({
  validationToken,
  groupId,
  deliverableType,
  sprintId,
  description,
}) => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const dragOverRef = useRef(false);

  const [file, setFile] = useState(null);
  const [fileSizeWarning, setFileSizeWarning] = useState(null);
  const [pipelineState, setPipelineState] = useState('file-selection');
  const [currentStep, setCurrentStep] = useState(null);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stagingId, setStagingId] = useState(null);
  const [successData, setSuccessData] = useState(null);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [failedStep, setFailedStep] = useState(null);

  const ACCEPTED_TYPES = ['.pdf', '.docx', '.md', '.zip'];
  const ACCEPTED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/markdown',
    'application/zip',
    'application/x-zip-compressed',
  ];
  const SIZE_WARN_MB = 500;
  const SIZE_BLOCK_MB = 1000;

  const validateFile = (selectedFile) => {
    if (!selectedFile) return false;

    const fileExtension = '.' + selectedFile.name.split('.').pop().toLowerCase();
    const isValidType =
      ACCEPTED_TYPES.includes(fileExtension) ||
      ACCEPTED_MIME_TYPES.includes(selectedFile.type);

    if (!isValidType) {
      setError(`Invalid file type. Accepted types: ${ACCEPTED_TYPES.join(', ')}`);
      setErrorCode('INVALID_FILE_TYPE');
      return false;
    }

    const sizeMB = selectedFile.size / (1024 * 1024);

    if (sizeMB > SIZE_BLOCK_MB) {
      setError(`File size exceeds 1GB limit. Current size: ${sizeMB.toFixed(2)}MB`);
      setErrorCode('FILE_TOO_LARGE');
      return false;
    }

    if (sizeMB > SIZE_WARN_MB) {
      setFileSizeWarning(`File is ${sizeMB.toFixed(2)}MB (larger than recommended 500MB)`);
    } else {
      setFileSizeWarning(null);
    }

    setError(null);
    setErrorCode(null);
    return true;
  };

  const handleFileSelect = (selectedFile) => {
    if (validateFile(selectedFile)) setFile(selectedFile);
  };

  const handleFileInputChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelect(selectedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    dragOverRef.current = true;
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragOverRef.current = false;
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragOverRef.current = false;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  // ── FIX 1: local `activeStep` instead of stale `currentStep` state ──
  const executePipeline = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setPipelineState('uploading');
    setCompletedSteps([]);
    setFailedStep(null);
    setError(null);
    setErrorCode(null);

    let activeStep = 0;

    try {
      activeStep = 1;
      setCurrentStep(1);
      const formData = new FormData();
      formData.append('groupId', groupId);
      formData.append('deliverableType', deliverableType);
      formData.append('sprintId', sprintId);
      formData.append('file', file);
      if (description) formData.append('description', description);

      const submitResponse = await submitDeliverable(formData, validationToken);
      setStagingId(submitResponse.stagingId);
      setUploadProgress(25);
      setCompletedSteps([1]);

      activeStep = 2;
      setCurrentStep(2);
      await validateFormat(submitResponse.stagingId, validationToken);
      setUploadProgress(50);
      setCompletedSteps([1, 2]);

      activeStep = 3;
      setCurrentStep(3);
      await validateDeadline(submitResponse.stagingId, sprintId, validationToken);
      setUploadProgress(75);
      setCompletedSteps([1, 2, 3]);

      activeStep = 4;
      setCurrentStep(4);
      const storeResponse = await storeDeliverable(submitResponse.stagingId, validationToken);
      setUploadProgress(100);
      setCompletedSteps([1, 2, 3, 4]);
      setSuccessData(storeResponse);
      setPipelineState('success');
      setCurrentStep(null);
    } catch (err) {
      const errData = err.response?.data;
      setFailedStep(activeStep);
      setError(errData?.message || `Step ${activeStep} failed. Please try again.`);
      setErrorCode(errData?.code || `STEP_${activeStep}_FAILED`);
      setPipelineState('error');
    }
  };

  // ── FIX 2: retry continues pipeline from failed step ──
  const handleRetry = () => {
    if (!stagingId || !failedStep) return;

    setPipelineState('uploading');
    setError(null);
    setErrorCode(null);

    const retryFromStep = async (fromStep) => {
      let activeStep = fromStep;

      try {
        if (activeStep === 2) {
          setCurrentStep(2);
          await validateFormat(stagingId, validationToken);
          setCompletedSteps([1, 2]);
          setUploadProgress(50);
          activeStep = 3;
        }

        if (activeStep === 3) {
          setCurrentStep(3);
          await validateDeadline(stagingId, sprintId, validationToken);
          setCompletedSteps([1, 2, 3]);
          setUploadProgress(75);
          activeStep = 4;
        }

        if (activeStep === 4) {
          setCurrentStep(4);
          const storeResponse = await storeDeliverable(stagingId, validationToken);
          setCompletedSteps([1, 2, 3, 4]);
          setUploadProgress(100);
          setSuccessData(storeResponse);
          setPipelineState('success');
          setCurrentStep(null);
        }
      } catch (err) {
        const errData = err.response?.data;
        setFailedStep(activeStep);
        setError(errData?.message || `Retry failed at step ${activeStep}. Please try again.`);
        setErrorCode(errData?.code || `RETRY_STEP_${activeStep}_FAILED`);
        setPipelineState('error');
      }
    };

    retryFromStep(failedStep);
  };

  const handleCancel = () => {
    setFile(null);
    setStagingId(null);
    setFileSizeWarning(null);
    setError(null);
    setErrorCode(null);
    setFailedStep(null);
    setCurrentStep(null);
    setCompletedSteps([]);
    setUploadProgress(0);
    setPipelineState('file-selection');
  };

  const handleViewSubmission = () => {
    // Route the student back to their group dashboard (the canonical place
    // that lists submissions). The standalone "/dashboard/deliverables/:id"
    // page does not exist in the router, so navigating there 404s.
    const targetGroupId = successData?.groupId || groupId;
    if (targetGroupId) {
      navigate(`/groups/${targetGroupId}`);
    } else {
      navigate('/dashboard');
    }
  };

  // ── Success State ──
  if (pipelineState === 'success' && successData) {
    return (
      <div className="w-full max-w-xl mx-auto">
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-3xl text-center">
            <div className="h-16 w-16 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-100">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-emerald-900 mb-2">Submission successful!</h3>
            <p className="text-emerald-700 text-sm mb-6">Your deliverable has been successfully stored.</p>

            <div className="bg-white rounded-2xl p-4 mb-6 space-y-2 text-left border border-emerald-100">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-400">Deliverable ID</span>
                <span className="text-sm font-mono text-slate-700">{successData.deliverableId}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-400">Submitted At</span>
                <span className="text-sm text-slate-700">
                  {new Date(successData.submittedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-400">Version</span>
                <span className="text-sm text-slate-700">{successData.version}</span>
              </div>
            </div>

            <button
              onClick={handleViewSubmission}
              className="w-full px-6 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all"
            >
              View Submission
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── File Selection State ──
  if (pipelineState === 'file-selection') {
    return (
      <div className="w-full max-w-xl mx-auto">
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <svg className="h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Finalize Submission
          </h3>

          <div className="mb-8 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
            <div className="grid grid-cols-2 gap-4 text-xs font-bold uppercase tracking-wider">
              <div>
                <span className="text-slate-400 block mb-1">Type</span>
                <span className="text-indigo-600">{deliverableType.replace(/_/g, ' ')}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Sprint</span>
                <span className="text-indigo-600">{sprintId}</span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="relative group">
              <input
                ref={fileInputRef}
                type="file"
                id="file-upload"
                onChange={handleFileInputChange}
                accept={ACCEPTED_TYPES.join(',')}
                className="hidden"
              />
              <label
                htmlFor="file-upload"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-full h-40 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all ${
                  file ? 'border-emerald-200 bg-emerald-50/10' : 'border-slate-200 bg-slate-50 hover:border-indigo-300'
                }`}
              >
                <div className={`p-3 rounded-full mb-3 ${
                  file ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-500'
                }`}>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                {file ? (
                  <span className="text-sm font-bold text-slate-700">{file.name}</span>
                ) : (
                  <>
                    <span className="text-sm font-bold text-slate-400 group-hover:text-indigo-600 transition-colors">
                      Drag and drop your file here
                    </span>
                    <span className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-bold">
                      or click to browse
                    </span>
                  </>
                )}
                <span className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">
                  {ACCEPTED_TYPES.join(', ')} • Max 1GB
                </span>
              </label>
            </div>

            {fileSizeWarning && (
              <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-2xl flex items-start gap-3">
                <div className="text-yellow-600 mt-0.5">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-xs font-bold text-yellow-800">{fileSizeWarning}</p>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                <div className="text-red-500 mt-0.5">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-xs font-bold text-red-800">{error}</p>
              </div>
            )}

            <button
              onClick={executePipeline}
              disabled={!file}
              className={`${
                !file ? 'opacity-50 cursor-not-allowed' : 'opacity-100 cursor-pointer hover:shadow-lg'
              } w-full p-[13px] bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-md text-base font-semibold transition-all duration-200 mt-2`}
            >
              Submit Deliverable
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Uploading / Error State ──
  if (pipelineState === 'uploading' || pipelineState === 'error') {
    return (
      <div className="w-full max-w-xl mx-auto">
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-8">Submission Pipeline</h3>

          <div className="space-y-4 mb-8">
            {[1, 2, 3, 4].map((stepNum) => (
              <div key={stepNum} className="flex items-center gap-4">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                  completedSteps.includes(stepNum)
                    ? 'bg-emerald-500 text-white'
                    : failedStep === stepNum
                    ? 'bg-red-500 text-white'
                    : currentStep === stepNum
                    ? 'bg-indigo-500 text-white animate-pulse'
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {completedSteps.includes(stepNum) ? (
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : failedStep === stepNum ? (
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    stepNum
                  )}
                </div>

                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-800">
                    {stepNum === 1 && 'Uploading File'}
                    {stepNum === 2 && 'Validating Format'}
                    {stepNum === 3 && 'Checking Deadline'}
                    {stepNum === 4 && 'Saving Submission'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {stepNum === 1 && 'Transferring file to staging area'}
                    {stepNum === 2 && 'Verifying file format and integrity'}
                    {stepNum === 3 && 'Confirming deadline compliance'}
                    {stepNum === 4 && 'Storing submission permanently'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {pipelineState === 'uploading' && (
            <div className="mb-8 space-y-2">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                <span>Processing...</span>
                <span>{uploadProgress}%</span>
              </div>
            </div>
          )}

          {pipelineState === 'error' && error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
              <div className="text-red-500 mt-0.5">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-800">{error}</p>
                <p className="text-xs text-red-600 mt-1">{failedStep && `Failed at step ${failedStep}`}</p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {pipelineState === 'error' && (
              <>
                <button
                  onClick={handleRetry}
                  className="flex-1 px-4 py-3 bg-indigo-600 text-white font-bold rounded-md hover:bg-indigo-700 transition-all"
                >
                  Retry Step {failedStep}
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 px-4 py-3 bg-slate-200 text-slate-700 font-bold rounded-md hover:bg-slate-300 transition-all"
                >
                  Cancel
                </button>
              </>
            )}
            {pipelineState === 'uploading' && (
              <button
                onClick={handleCancel}
                className="w-full px-4 py-3 bg-slate-200 text-slate-700 font-bold rounded-md hover:bg-slate-300 transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default FileUploadWidget;