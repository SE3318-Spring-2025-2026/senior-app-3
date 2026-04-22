import React, { useMemo, useState } from 'react';

const formatRatio = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;

const ContributionResultsTable = ({ summary }) => {
  const rows = summary?.contributions || [];
  const [searchTerm, setSearchTerm] = useState('');
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [sortBy, setSortBy] = useState('ratio_desc');

  const filteredAndSortedRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        String(row.studentName || '')
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(row.studentId || '')
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesWarnings = !warningsOnly || Number(row.mappingWarningsCount || 0) > 0;
      return matchesSearch && matchesWarnings;
    });

    const sorted = [...filtered];
    if (sortBy === 'name_asc') {
      sorted.sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || '')));
    } else if (sortBy === 'completed_desc') {
      sorted.sort((a, b) => Number(b.completedStoryPoints || 0) - Number(a.completedStoryPoints || 0));
    } else if (sortBy === 'target_desc') {
      sorted.sort((a, b) => Number(b.targetStoryPoints || 0) - Number(a.targetStoryPoints || 0));
    } else if (sortBy === 'warnings_desc') {
      sorted.sort((a, b) => Number(b.mappingWarningsCount || 0) - Number(a.mappingWarningsCount || 0));
    } else {
      sorted.sort((a, b) => Number(b.contributionRatio || 0) - Number(a.contributionRatio || 0));
    }

    return sorted;
  }, [rows, searchTerm, warningsOnly, sortBy]);

  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <h2 className="text-lg font-semibold text-slate-900 mb-2">Contribution Results</h2>

      {summary && (
        <div className="mb-4 rounded-md bg-slate-50 border border-slate-200 p-3">
          <p className="text-sm text-slate-800">{summary.summaryMessage}</p>
          <p className="text-xs text-slate-500 mt-1">Recalculated at: {new Date(summary.recalculatedAt).toLocaleString()}</p>
          {summary.summaryWarnings?.length > 0 && (
            <ul className="mt-2 text-xs text-amber-700 list-disc pl-5">
              {summary.summaryWarnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Run recalculation to see per-student contribution metrics.</p>
      ) : (
        <div>
          <div className="mb-3 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Filter by student name or ID"
              className="w-full md:max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={warningsOnly}
                  onChange={(event) => setWarningsOnly(event.target.checked)}
                />
                Warnings only
              </label>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="ratio_desc">Sort: Ratio (high to low)</option>
                <option value="name_asc">Sort: Name (A-Z)</option>
                <option value="completed_desc">Sort: Completed SP</option>
                <option value="target_desc">Sort: Target SP</option>
                <option value="warnings_desc">Sort: Warnings</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Student Name</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Completed SP</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Target SP</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Ratio</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-700">Mapping Warnings</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedRows.map((row) => (
                <tr key={row.studentId} className="border-b border-slate-100">
                  <td className="px-3 py-2 text-slate-800">{row.studentName}</td>
                  <td className="px-3 py-2 text-slate-700">{row.completedStoryPoints}</td>
                  <td className="px-3 py-2 text-slate-700">{row.targetStoryPoints}</td>
                  <td className="px-3 py-2 text-slate-700">{formatRatio(row.contributionRatio)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.mappingWarningsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {filteredAndSortedRows.length === 0 && (
            <p className="text-sm text-slate-500 mt-3">No students match the selected filter.</p>
          )}
        </div>
      )}
    </section>
  );
};

export default ContributionResultsTable;
