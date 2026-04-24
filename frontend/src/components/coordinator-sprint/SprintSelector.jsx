import React from 'react';

const SprintSelector = ({
  groups,
  selectedGroupId,
  selectedSprintId,
  onGroupChange,
  onSprintChange,
  loadingGroups,
}) => {
  const selectedGroup = groups.find((group) => group.groupId === selectedGroupId);
  const sprintOptions = Array.isArray(selectedGroup?.sprints) ? selectedGroup.sprints : [];

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
            {groups.map((group) => (
              <option key={group.groupId} value={group.groupId}>
                {group.groupName} ({group.groupId})
              </option>
            ))}
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
            <option value="">{selectedGroupId ? 'Select sprint' : 'Choose group first'}</option>
            {sprintOptions.map((sprint) => {
              const sprintId = sprint.sprintId || sprint.id || sprint.key;
              const sprintName = sprint.name || sprint.sprintName || sprintId;
              if (!sprintId) return null;
              return (
                <option key={sprintId} value={sprintId}>
                  {sprintName}
                </option>
              );
            })}
          </select>
          <p className="text-xs text-slate-500 mt-1">
            If no sprint list is returned by backend yet, you can type a sprint id below.
          </p>
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
    </section>
  );
};

export default SprintSelector;
