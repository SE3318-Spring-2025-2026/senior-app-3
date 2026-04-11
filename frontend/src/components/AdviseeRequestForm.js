import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { createAdvisorRequest, getGroup, getScheduleWindow } from '../api/groupService';
import './AdviseeRequestForm.css';

/**
 * Team leader submits a request for a faculty advisor (Process 3.1 → 3.2).
 */
const AdviseeRequestForm = () => {
  const { group_id: groupId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [professorId, setProfessorId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [windowOpen, setWindowOpen] = useState(true);
  const [groupMeta, setGroupMeta] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!groupId || !user?.userId) {
        setLoading(false);
        return;
      }
      try {
        const [g, sw] = await Promise.all([
          getGroup(groupId),
          getScheduleWindow('advisor_association'),
        ]);
        if (cancelled) return;
        setGroupMeta(g);
        setWindowOpen(sw?.open !== false);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.message || 'Could not load group.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, user?.userId]);

  const isLeader = groupMeta?.leaderId === user?.userId;
  const hasPendingRequest = groupMeta?.advisorRequest?.status === 'pending';
  const canSubmit =
    isLeader &&
    user?.role === 'student' &&
    groupMeta?.status === 'active' &&
    !groupMeta?.advisorId &&
    !hasPendingRequest;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const pid = professorId.trim();
    if (!pid) {
      setError('Professor user ID is required.');
      return;
    }
    setSubmitting(true);
    try {
      await createAdvisorRequest({
        groupId,
        professorId: pid,
        requesterId: user.userId,
        message: message.trim() || undefined,
      });
      navigate(`/groups/${groupId}`);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'OUTSIDE_SCHEDULE_WINDOW') {
        setError(data?.message || 'Advisor requests are not open in the current schedule window.');
      } else {
        setError(data?.message || 'Could not submit advisor request.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!groupId) {
    return <div className="page error">Invalid group</div>;
  }

  if (loading) {
    return <div className="advisee-request-page loading">Loading…</div>;
  }

  return (
    <div className="advisee-request-page">
      <div className="advisee-request-header">
        <h1>Request a faculty advisor</h1>
        <p className="advisee-request-lead">
          {groupMeta?.groupName ? (
            <>
              Group: <strong>{groupMeta.groupName}</strong>
            </>
          ) : (
            <>Group ID: {groupId}</>
          )}
        </p>
        <Link to={`/groups/${groupId}`} className="advisee-request-back">
          ← Back to group dashboard
        </Link>
      </div>

      {!windowOpen && (
        <div className="advisee-request-banner warn">
          The advisor association schedule is currently closed. You can still prepare the form, but submission
          will be rejected until a coordinator opens the window.
        </div>
      )}

      {!isLeader && (
        <div className="advisee-request-banner warn">Only the team leader can submit an advisor request.</div>
      )}

      {groupMeta?.advisorId && (
        <div className="advisee-request-banner info">This group already has an advisor assigned.</div>
      )}

      {hasPendingRequest && (
        <div className="advisee-request-banner info">
          This group already has a pending advisor request to{' '}
          <strong>{groupMeta.advisorRequest.professorName || groupMeta.advisorRequest.professorId}</strong>.
        </div>
      )}

      {groupMeta && groupMeta.status !== 'active' && (
        <div className="advisee-request-banner warn">Advisor requests are only available for active groups.</div>
      )}

      {error && <div className="advisee-request-error">{error}</div>}

      <form className="advisee-request-form" onSubmit={handleSubmit}>
        <label className="advisee-request-label">
          Professor user ID
          <input
            type="text"
            name="professorId"
            value={professorId}
            onChange={(e) => setProfessorId(e.target.value)}
            placeholder="e.g. usr_abc123"
            autoComplete="off"
            disabled={!canSubmit || submitting}
          />
        </label>
        <p className="advisee-request-hint">
          Enter the professor&apos;s account user ID (from your coordinator or the faculty member). This must match
          an active professor account in the system.
        </p>

        <label className="advisee-request-label">
          Message <span className="optional">(optional)</span>
          <textarea
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Brief context for the professor…"
            disabled={!canSubmit || submitting}
          />
        </label>

        <button type="submit" className="advisee-request-submit" disabled={!canSubmit || submitting}>
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </form>
    </div>
  );
};

export default AdviseeRequestForm;
