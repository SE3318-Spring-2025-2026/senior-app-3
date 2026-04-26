import React, { useMemo, useState } from 'react';
import { bootstrapSprint } from '../../api/sprintTrackingService';

const SprintSelector = ({
  groups,
  selectedGroupId,
  selectedSprintId,
  onGroupChange,
  onSprintChange,
  loadingGroups,
  onSprintsRefresh,
}) => {
  const normalizedGroups = useMemo(
    () => (Array.isArray(groups) ? groups : []),
    [groups]
  );

  const selectedGroup = normalizedGroups.find((group) => group.groupId === selectedGroupId);
  const sprintOptions = Array.isArray(selectedGroup?.sprints) ? selectedGroup.sprints : [];
  const groupHasNoSprints = Boolean(selectedGroup) && sprintOptions.length === 0;

  const [bootstrapId, setBootstrapId] = useState('');
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [bootstrapInfo, setBootstrapInfo] = useState('');

  const handleBootstrap = async () => {
    if (!selectedGroupId) return;
    setBootstrapBusy(true);
    setBootstrapError('');
    setBootstrapInfo('');
    try {
      const result = await bootstrapSprint({
        groupId: selectedGroupId,
        sprintId: bootstrapId.trim() || undefined,
      });
      setBootstrapInfo(`Created sprint ${result.sprintId} (status: ${result.status}).`);
      setBootstrapId('');
      if (typeof onSprintsRefresh === 'function') {
        await onSprintsRefresh();
      }
      onSprintChange(result.sprintId);
    } catch (err) {
      const data = err?.response?.data || {};
      const code = data.code;
      if (code === 'SPRINT_ALREADY_EXISTS') {
        setBootstrapError(
          data.message ||
            'A sprint with that id already exists for this group. Pick a different id or use the existing one.'
        );
      } else if (code === 'INVALID_SPRINT_ID') {
        setBootstrapError(
          'Invalid sprint id. Use only letters, digits, dot (.), dash (-) and underscore (_).'
        );
      } else if (code === 'GROUP_NOT_FOUND') {
        setBootstrapError('Group not found. Refresh the dashboard.');
      } else if (err?.response?.status === 403) {
        setBootstrapError('Coordinator/admin role required to bootstrap a sprint.');
      } else {
        setBootstrapError(data.message || 'Failed to bootstrap sprint. Please try again.');
      }
    } finally {
      setBootstrapBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Sprint Selector</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="group-select">
            Group
          </label>
          <select
            id="group-select"
            value={selectedGroupId}
            onChange={(event) => onGroupChange(event.target.value)}
            disabled={loadingGroups}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{loadingGroups ? 'Loading groups...' : 'Select group'}</option>
            {normalizedGroups.map((group, index) => {
              const groupId = group.groupId || group.id || `group-${index}`;
              const optionKey = `group-option-${index}-${String(groupId)}`;
              return (
                <option key={optionKey} value={groupId}>
                  {(group.groupName || 'Unnamed Group')} ({groupId})
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="sprint-select">
            Sprint
          </label>
          <select
            id="sprint-select"
            value={selectedSprintId}
            onChange={(event) => onSprintChange(event.target.value)}
            disabled={!selectedGroupId}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">
              {selectedGroupId
                ? (groupHasNoSprints ? 'No sprints recorded for this group yet' : 'Select sprint')
                : 'Choose group first'}
            </option>
            {sprintOptions.map((sprint, index) => {
              const sprintId = sprint.sprintId || sprint.id || sprint.key;
              const sprintName =
                sprint.name ||
                sprint.sprintName ||
                (sprint.status ? `${sprintId} (${sprint.status})` : sprintId);
              if (!sprintId) return null;
              const optionKey = `sprint-option-${index}-${String(sprintId)}`;
              return (
                <option key={optionKey} value={sprintId}>
                  {sprintName}
                </option>
              );
            })}
          </select>
          {groupHasNoSprints ? (
            <p className="text-xs text-amber-700 mt-1">
              This group has no sprint records yet. Sprints are created when the
              coordinator runs a Jira/GitHub sync, or by seeding fixtures
              (<code>npm run seed:test-general</code>). You can still type a manual
              sprint ID below to recover from an external system.
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-1">
              If the sprint list is missing, you can type a sprint id below.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="sprint-input">
          Sprint ID (manual override)
        </label>
        <input
          id="sprint-input"
          type="text"
          value={selectedSprintId}
          onChange={(event) => onSprintChange(event.target.value)}
          placeholder="e.g. sprint-2026-04"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          disabled={!selectedGroupId}
        />
      </div>

      {selectedGroupId && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            Bootstrap empty sprint
          </h3>
          <p className="text-xs text-slate-500 mb-2">
            Use this when the group has no Jira/GitHub credentials but you still want to
            unblock deliverable assignment, recalculate, and final-grade preview. Creates
            a SprintRecord with <code>status: pending</code> and no deliverable refs. The
            id is generated automatically when left blank (e.g. <code>bootstrap-sprint-1</code>).
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={bootstrapId}
              onChange={(event) => setBootstrapId(event.target.value)}
              placeholder="Optional sprintId (letters, digits, . - _)"
              className="flex-1 min-w-[14rem] rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={bootstrapBusy}
            />
            <button
              type="button"
              onClick={handleBootstrap}
              disabled={bootstrapBusy || !selectedGroupId}
              className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm disabled:opacity-50"
            >
              {bootstrapBusy ? 'Creating…' : 'Create empty sprint'}
            </button>
          </div>
          {bootstrapError && (
            <p className="text-xs text-red-700 mt-2">{bootstrapError}</p>
          )}
          {bootstrapInfo && (
            <p className="text-xs text-emerald-700 mt-2">{bootstrapInfo}</p>
          )}
        </div>
      )}
    </section>
  );
};

export default SprintSelector;
