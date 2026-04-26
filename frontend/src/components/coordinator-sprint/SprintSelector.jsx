import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bootstrapSprint } from '../../api/sprintTrackingService';

const BoundedDropdown = ({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const handleSelect = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full min-h-[38px] rounded-md border border-slate-300 bg-white px-3 py-2 pr-9 text-left text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
      >
        <span className="block truncate">{selectedOption?.label || placeholder}</span>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => handleSelect('')}
            className={`block w-full px-3 py-2 text-left hover:bg-indigo-50 ${
              !value ? 'bg-indigo-600 text-white hover:bg-indigo-600' : 'text-slate-700'
            }`}
          >
            <span className="block truncate">{placeholder}</span>
          </button>
          {options.map((option) => (
            <button
              key={option.key || option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => handleSelect(option.value)}
              className={`block w-full px-3 py-2 text-left hover:bg-indigo-50 ${
                option.value === value
                  ? 'bg-indigo-600 text-white hover:bg-indigo-600'
                  : 'text-slate-700'
              }`}
            >
              <span className="block truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
  const groupOptions = normalizedGroups.map((group, index) => {
    const groupId = group.groupId || group.id || `group-${index}`;
    return {
      key: `group-option-${index}-${String(groupId)}`,
      value: groupId,
      label: `${group.groupName || 'Unnamed Group'} (${groupId})`,
    };
  });
  const sprintSelectOptions = sprintOptions
    .map((sprint, index) => {
      const sprintId = sprint.sprintId || sprint.id || sprint.key;
      if (!sprintId) return null;
      const sprintName =
        sprint.name ||
        sprint.sprintName ||
        (sprint.status ? `${sprintId} (${sprint.status})` : sprintId);
      return {
        key: `sprint-option-${index}-${String(sprintId)}`,
        value: sprintId,
        label: sprintName,
      };
    })
    .filter(Boolean);

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
          <BoundedDropdown
            id="group-select"
            value={selectedGroupId}
            onChange={onGroupChange}
            disabled={loadingGroups}
            placeholder={loadingGroups ? 'Loading groups...' : 'Select group'}
            options={groupOptions}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="sprint-select">
            Sprint
          </label>
          <BoundedDropdown
            id="sprint-select"
            value={selectedSprintId}
            onChange={onSprintChange}
            disabled={!selectedGroupId}
            placeholder={
              selectedGroupId
                ? (groupHasNoSprints ? 'No sprints recorded for this group yet' : 'Select sprint')
                : 'Choose group first'
            }
            options={sprintSelectOptions}
          />
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
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              className="flex-1 min-w-[14rem] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
