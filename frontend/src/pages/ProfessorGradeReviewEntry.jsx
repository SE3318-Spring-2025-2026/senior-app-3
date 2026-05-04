import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { normalizeGroupId } from '../utils/groupId';
import { getMyAdvisorRequests } from '../api/advisorService';
import './ProfessorGradeReviewEntry.css';

/**
 * Professors/advisors often lack `groupId` on the JWT; the sidebar "Grade Review"
 * link is hidden. This page lets them select from their assigned groups or paste
 * a group id to open the read-only final grade review route.
 */
const ProfessorGradeReviewEntry = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [rawId, setRawId] = useState('');
  const [assignedGroups, setAssignedGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);

  useEffect(() => {
    getMyAdvisorRequests()
      .then((requests) => {
        const approved = requests.filter(
          (r) => r.status === 'approved' || r.decision === 'approve'
        );
        setAssignedGroups(approved);
      })
      .catch(() => setAssignedGroups([]))
      .finally(() => setGroupsLoading(false));
  }, []);

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

  const go = (groupId) => {
    const id = normalizeGroupId(groupId || rawId.trim());
    if (!id) return;
    navigate(`/groups/${id}/final-grades/review`);
  };

  return (
    <div className="grade-review-entry-page">
      <div className="grade-review-entry-card">
        <header className="grade-review-entry-header">
          <h1>Final grade review</h1>
          <p>
            Open the read-only snapshot for a group after the coordinator has generated a preview.
          </p>
        </header>

        {!groupsLoading && assignedGroups.length > 0 && (
          <div className="grade-review-assigned-groups">
            <label htmlFor="grade-review-group-select">Your assigned groups</label>
            <div className="grade-review-entry-actions">
              <select
                id="grade-review-group-select"
                defaultValue=""
                onChange={(e) => e.target.value && go(e.target.value)}
              >
                <option value="" disabled>-- Select a group --</option>
                {assignedGroups.map((r) => (
                  <option key={r.requestId} value={r.groupId}>
                    {r.groupName || r.groupId}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {hintedGroupId && !assignedGroups.find((r) => r.groupId === hintedGroupId) && (
          <div className="grade-review-linked-group">
            <p>Linked group on your account</p>
            <button type="button" onClick={() => go(hintedGroupId)} className="grade-review-linked-btn">
              {hintedGroupId}
            </button>
          </div>
        )}

        <label htmlFor="grade-review-group">Enter group ID manually</label>
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
            onClick={() => go()}
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
