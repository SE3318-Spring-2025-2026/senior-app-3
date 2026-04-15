import React, { useState } from 'react';
import apiClient from '../../api/apiClient';

/**
 * FileUploadWidget Component — Process 5.2
 * Handles the actual file selection and upload using the validationToken.
 */
const FileUploadWidget = ({
  validationToken,
  groupId,
  deliverableType,
  sprintId,
  description,
  onSuccess
}) => {
  const [file, setFile] = useState(null);
  const [uploadState, setUploadState] = useState('initial'); // initial, uploading, success, error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setUploadState('uploading');
    setProgress(10); // Start progress

    try {
      const formData = new FormData();
      formData.append('groupId', groupId);
      formData.append('deliverableType', deliverableType);
      formData.append('sprintId', sprintId);
      formData.append('file', file);
      if (description) formData.append('description', description);

      const response = await apiClient.post('/deliverables/submit', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization-Validation': validationToken,
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(percentCompleted);
        },
      });

      setUploadState('success');
      if (onSuccess) onSuccess(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed. Please try again.');
      setUploadState('error');
    }
  };

  if (uploadState === 'success') {
    return (
      <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-3xl text-center">
        <div className="h-16 w-16 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-100">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-emerald-900 mb-2">Upload Complete!</h3>
        <p className="text-emerald-700 text-sm mb-6">Your deliverable has been safely staged in the Academic Center.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all"
        >
          Done
        </button>
      </div>
    );
  }

  return (
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
            type="file"
            id="file-upload"
            onChange={handleFileChange}
            className="hidden"
          />
          <label
            htmlFor="file-upload"
            className={`w-full h-40 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all ${file ? 'border-emerald-200 bg-emerald-50/10' : 'border-slate-200 bg-slate-50 hover:border-indigo-300'
              }`}
          >
            <div className={`p-3 rounded-full mb-3 ${file ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-500'}`}>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            {file ? (
              <span className="text-sm font-bold text-slate-700">{file.name}</span>
            ) : (
              <span className="text-sm font-bold text-slate-400 group-hover:text-indigo-600 transition-colors">Select PDF or Archive</span>
            )}
            <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-bold">Max 50MB</span>
          </label>
        </div>

        {uploadState === 'uploading' && (
          <div className="space-y-2">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
              <span>Uploading...</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-500 font-bold">{error}</p>}

        <button
          onClick={handleUpload}
          disabled={!file || uploadState === 'uploading'}
          className={`${!file || uploadState === 'uploading' ? "opacity-50 cursor-not-allowed" : "opacity-100 cursor-pointer"} w-full p-[13px] bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white rounded-md text-base font-semibold transition-opacity duration-200 mt-2`} >
          {uploadState === 'uploading' ? 'Sending to Staging...' : 'Submit Deliverable'}
        </button>
      </div>
    </div>
  );
};

export default FileUploadWidget;
