import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { normalizeGroupId } from '../utils/groupId';
import './ProfessorGradeReviewEntry.css';

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
    <div className="grade-review-entry-page">
      <div className="grade-review-entry-card">
        <header className="grade-review-entry-header">
          <h1>Final grade review</h1>
          <p>
            Open the read-only snapshot for a group after the coordinator has generated a preview.
          </p>
          <code>/groups/&lt;groupId&gt;/final-grades/review</code>
        </header>

        {hintedGroupId && (
          <div className="grade-review-linked-group">
            <p>Linked group on your account</p>
            <Link to={`/groups/${hintedGroupId}/final-grades/review`}>
              {hintedGroupId}
            </Link>
          </div>
        )}

        <label htmlFor="grade-review-group">Group ID</label>
        <div className="grade-review-entry-actions">
          <input
            id="grade-review-group"
            type="text"
            placeholder="e.g. grp_9d7ee1f4"
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <button
            type="button"
            disabled={!normalized}
            onClick={go}
          >
            Open review
          </button>
        </div>
        {!normalized && rawId.trim() && (
          <p className="grade-review-entry-warning">Enter a valid group id (grp_...).</p>
        )}
      </div>
    </div>
  );
};

export default ProfessorGradeReviewEntry;
