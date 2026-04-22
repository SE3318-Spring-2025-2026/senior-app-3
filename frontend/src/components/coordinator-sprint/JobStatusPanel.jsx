import React from 'react';

const statusStyleMap = {
  queued: 'bg-amber-100 text-amber-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const JobStatusPanel = ({ jobs, onViewLogs, logDetailsBySource = {} }) => {
  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Job Status</h2>
      {jobs.length === 0 && (
        <p className="text-sm text-slate-500">No sync job has been triggered yet for this sprint.</p>
      )}

      <div className="space-y-4">
        {jobs.map((job) => (
          <article key={`${job.source}-${job.jobId || 'latest'}`} className="border border-slate-200 rounded-md p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 uppercase">{job.source} sync</p>
                <p className="text-xs text-slate-500">Job ID: {job.jobId || '—'}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusStyleMap[job.status] || 'bg-slate-100 text-slate-700'}`}>
                {job.status}
              </span>
            </div>

            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full ${job.status === 'failed' ? 'bg-red-500' : 'bg-indigo-500'}`}
                  style={{ width: `${job.progress || 0}%` }}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600">
              <p>Started: {formatDate(job.startedAt || job.createdAt)}</p>
              <p>Ended: {formatDate(job.completedAt || job.updatedAt)}</p>
            </div>

            {job.lastError && (
              <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-sm font-medium text-red-700 mb-1">Last error</p>
                <p className="text-xs text-red-700">{job.lastError}</p>
              </div>
            )}

            {(job.status === 'completed' || job.status === 'failed') && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => onViewLogs?.(job)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline transition-colors"
                >
                  {logDetailsBySource[job.source] ? 'Hide Logs' : 'View Logs'}
                </button>
              </div>
            )}

            {logDetailsBySource[job.source] && (
              <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                  <p className="text-xs text-slate-700 font-medium">
                    Status Code: <span className="font-normal">{logDetailsBySource[job.source].errorCode || 'SUCCESS'}</span>
                  </p>
                  {logDetailsBySource[job.source].errorMessage && (
                    <p className="text-xs text-red-600 font-medium">
                      Error: <span className="font-normal">{logDetailsBySource[job.source].errorMessage}</span>
                    </p>
                  )}
                </div>
                
                {Array.isArray(logDetailsBySource[job.source].validationRecords) &&
                  logDetailsBySource[job.source].validationRecords.length > 0 && (
                    <p className="text-xs text-slate-700 mb-2">
                      Validation records: <span className="font-semibold">{logDetailsBySource[job.source].validationRecords.length}</span>
                    </p>
                  )}
                
                {Array.isArray(logDetailsBySource[job.source].logs) &&
                  logDetailsBySource[job.source].logs.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <p className="text-xs font-semibold text-slate-700 mb-1">Recent log entries:</p>
                      <ul className="space-y-1">
                        {logDetailsBySource[job.source].logs.slice(-5).map((entry, index) => (
                          <li key={`${job.source}-log-${index}`} className="text-xs text-slate-600 leading-relaxed">
                            <span className={`font-mono uppercase ${entry.level === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                              [{entry.level || 'info'}]
                            </span>{' '}
                            <span className="text-slate-400">{formatDate(entry.at)}:</span> {entry.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export default JobStatusPanel;
