import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { normalizeGroupId } from '../utils/groupId';

/**
 * Professors/advisors often lack `groupId` on the JWT; the sidebar "Grade Review"
 * link is hidden. This page lets them paste a group id (e.g. from the coordinator)
 * and open the read-only final grade review route.
 */
const ProfessorGradeReviewEntry = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [rawId, setRawId] = useState('');

  const hintedGroupId = useMemo(() => {
    const candidates = [
      user?.groupId,
      user?.advisedGroupId,
      user?.advisorGroupId,
      user?.currentGroupId,
    ];
    return candidates.map((v) => normalizeGroupId(v)).find(Boolean) || '';
  }, [user]);

  const normalized = normalizeGroupId(rawId.trim());

  const go = () => {
    if (!normalized) return;
    navigate(`/groups/${normalized}/final-grades/review`);
  };

  return (
    <div className="page p-8 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-800 mb-2">Final grade review</h1>
      <p className="text-slate-600 text-sm mb-6">
        Open the read-only snapshot for a group after the coordinator has generated a preview.
        URL pattern:{' '}
        <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">/groups/&lt;groupId&gt;/final-grades/review</code>
      </p>

      {hintedGroupId && (
        <div className="mb-6 p-4 rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-900 text-sm">
          <p className="font-medium mb-2">Linked group on your account</p>
          <Link
            className="text-emerald-800 underline font-mono text-sm"
            to={`/groups/${hintedGroupId}/final-grades/review`}
          >
            {hintedGroupId}
          </Link>
        </div>
      )}

      <label htmlFor="grade-review-group" className="block text-sm font-medium text-slate-700 mb-1">
        Group ID
      </label>
      <div className="flex gap-2 flex-wrap">
        <input
          id="grade-review-group"
          type="text"
          className="flex-1 min-w-[200px] border border-slate-300 rounded-md px-3 py-2 text-sm font-mono"
          placeholder="e.g. grp_9d7ee1f4"
          value={rawId}
          onChange={(e) => setRawId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <button
          type="button"
          className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
          disabled={!normalized}
          onClick={go}
        >
          Open review
        </button>
      </div>
      {!normalized && rawId.trim() && (
        <p className="text-amber-700 text-xs mt-2">Enter a valid group id (grp_…).</p>
      )}
    </div>
  );
};

export default ProfessorGradeReviewEntry;
