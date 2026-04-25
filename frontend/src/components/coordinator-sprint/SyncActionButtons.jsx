import React from 'react';

const buttonBaseClass =
  'rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed';

const SyncActionButtons = ({
  disabled,
  jiraDisabled = false,
  githubDisabled = false,
  jiraLoading,
  githubLoading,
  recalcLoading,
  onRunJiraSync,
  onRunGithubSync,
  onRecalculate,
}) => {
  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Actions</h2>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRunJiraSync}
          disabled={disabled || jiraDisabled || jiraLoading}
          className={`${buttonBaseClass} bg-blue-600 hover:bg-blue-700`}
        >
          {jiraLoading ? 'Running JIRA Sync...' : 'Run JIRA Sync'}
        </button>

        <button
          type="button"
          onClick={onRunGithubSync}
          disabled={disabled || githubDisabled || githubLoading}
          className={`${buttonBaseClass} bg-slate-800 hover:bg-slate-900`}
        >
          {githubLoading ? 'Running GitHub Sync...' : 'Run GitHub Sync'}
        </button>

        <button
          type="button"
          onClick={onRecalculate}
          disabled={disabled || recalcLoading}
          className={`${buttonBaseClass} bg-emerald-600 hover:bg-emerald-700`}
        >
          {recalcLoading ? 'Recalculating...' : 'Recalculate Contributions'}
        </button>
      </div>
    </section>
  );
};

export default SyncActionButtons;
